"""FastAPI server for Prime Champs agent execution."""

import asyncio
import logging
import os
import secrets
from datetime import datetime
from typing import Dict, Any, Optional, List
from contextlib import asynccontextmanager
import uuid

logger = logging.getLogger("prime_champs.server")

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.agents import EnrichmentAgent, ResearchAgent, OutreachAgent, ScoringAgent
from backend.database import db
from backend.routes.instagram import router as instagram_router


# Store running/completed jobs with progress tracking
jobs: Dict[str, Dict[str, Any]] = {}

def update_job_progress(job_id: str, current: int, total: int, message: str = ""):
    """Update job progress. Called by agents during execution."""
    if job_id in jobs:
        jobs[job_id]["progress"] = {
            "current": current,
            "total": total,
            "percent": round((current / total) * 100) if total > 0 else 0,
            "message": message
        }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("Prime Champs Agent Server starting...")
    # Auto-start the autonomous pipeline scheduler when enabled. Survives here
    # so the loop runs without a human POSTing a start endpoint after restart.
    from backend.services.pipeline_scheduler import pipeline_scheduler
    if pipeline_scheduler.autorun_enabled():
        try:
            res = await pipeline_scheduler.start()
            print(f"Pipeline scheduler: {res.get('message')}")
        except Exception as e:
            logger.error("Failed to auto-start pipeline scheduler: %s", e)
    else:
        print("Pipeline scheduler autorun disabled (set PIPELINE_AUTORUN_ENABLED=true)")
    yield
    try:
        from backend.services.pipeline_scheduler import pipeline_scheduler
        await pipeline_scheduler.stop()
    except Exception:
        pass
    print("Prime Champs Agent Server shutting down...")


app = FastAPI(
    title="Prime Champs Agent API",
    description="API for running Prime Champs agents",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for Next.js dashboard. Override allowed origins in prod via
# BACKEND_CORS_ORIGINS (comma-separated). CORS only constrains browsers — the
# API-key check below is what actually protects the API from scripts/curl.
_cors_origins = os.environ.get(
    "BACKEND_CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API key auth -----------------------------------------------------------
# The dashboard's server-side routes call this API with an X-API-Key header.
# When BACKEND_API_KEY is set, every request must present it (except liveness
# probes and CORS preflight). When unset, the API runs OPEN and logs a loud
# warning — set the key (and bind to 127.0.0.1) for any non-localhost use.
BACKEND_API_KEY = os.environ.get("BACKEND_API_KEY", "").strip()
_OPEN_PATHS = {"/health", "/", "/docs", "/openapi.json", "/redoc"}

if not BACKEND_API_KEY:
    logger.warning(
        "BACKEND_API_KEY is not set — the agent API is UNAUTHENTICATED. "
        "Set it and bind to 127.0.0.1 before exposing this server."
    )


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if (
        BACKEND_API_KEY
        and request.method != "OPTIONS"
        and request.url.path not in _OPEN_PATHS
    ):
        provided = request.headers.get("x-api-key", "")
        if not secrets.compare_digest(provided, BACKEND_API_KEY):
            return JSONResponse({"detail": "Invalid or missing API key"}, status_code=401)
    return await call_next(request)


# Include routers
app.include_router(instagram_router)


# Request/Response Models
class AgentRunRequest(BaseModel):
    """Request to run an agent."""
    athlete_ids: Optional[List[str]] = None
    batch_size: Optional[int] = 10
    rescore: Optional[bool] = False
    sports: Optional[List[str]] = None
    max_results: Optional[int] = 20
    template: Optional[str] = None
    campaign_id: Optional[str] = None


class ProgressInfo(BaseModel):
    """Progress information."""
    current: int = 0
    total: int = 0
    percent: int = 0
    message: str = ""

class JobResponse(BaseModel):
    """Response with job details."""
    job_id: str
    agent: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    progress: Optional[ProgressInfo] = None


class AgentStatusResponse(BaseModel):
    """Response with agent status."""
    agent: str
    status: str
    last_run: Optional[str] = None
    last_result: Optional[Dict[str, Any]] = None


# Agent instances
agents = {
    "enrichment": EnrichmentAgent(),
    "research": ResearchAgent(),
    "outreach": OutreachAgent(),
    "scoring": ScoringAgent(),
}


async def run_agent_job(job_id: str, agent_name: str, params: dict):
    """Run an agent job in the background."""
    try:
        jobs[job_id]["status"] = "running"
        jobs[job_id]["progress"] = {"current": 0, "total": 0, "percent": 0, "message": "Starting..."}

        agent = agents.get(agent_name)
        if not agent:
            raise ValueError(f"Unknown agent: {agent_name}")

        # Create progress callback for this job
        def progress_callback(current: int, total: int, message: str = ""):
            update_job_progress(job_id, current, total, message)

        # Run the agent with appropriate parameters and progress callback
        if agent_name == "enrichment":
            result = await agent.run(
                athlete_id=params.get("athlete_ids", [None])[0] if params.get("athlete_ids") else None,
                batch_size=params.get("batch_size", 10),
                progress_callback=progress_callback
            )
        elif agent_name == "research":
            result = await agent.run(
                sports=params.get("sports"),
                max_results=params.get("max_results", 20),
                progress_callback=progress_callback
            )
        elif agent_name == "outreach":
            result = await agent.run(
                athlete_ids=params.get("athlete_ids"),
                campaign_id=params.get("campaign_id"),
                template=params.get("template"),
                progress_callback=progress_callback
            )
        elif agent_name == "scoring":
            result = await agent.run(
                athlete_ids=params.get("athlete_ids"),
                rescore=params.get("rescore", False),
                progress_callback=progress_callback
            )
        else:
            result = {"error": f"No handler for agent: {agent_name}"}

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["result"] = result
        jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

        # Log to database if agent_runs table exists
        try:
            db.client.table("agent_runs").insert({
                "agent_type": agent_name,
                "status": "completed",
                "records_processed": result.get("processed") or result.get("scored") or result.get("generated") or 0,
                "errors": result.get("failed", 0),
                "metadata": result
            }).execute()
        except Exception:
            pass  # Table might not exist yet

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

        # Log error to database
        try:
            db.client.table("agent_runs").insert({
                "agent_type": agent_name,
                "status": "failed",
                "errors": 1,
                "metadata": {"error": str(e)}
            }).execute()
        except Exception:
            pass


@app.get("/")
async def root():
    """Health check."""
    return {"status": "ok", "service": "Prime Champs Agent API"}


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/agents")
async def list_agents():
    """List all available agents."""
    agent_list = []
    for name in agents.keys():
        # Get last run from database
        last_run = None
        try:
            result = db.client.table("agent_runs").select("*").eq(
                "agent_type", name
            ).order("started_at", desc=True).limit(1).execute()
            if result.data:
                last_run = result.data[0]
        except Exception:
            pass

        agent_list.append({
            "id": name,
            "name": name.title(),
            "last_run": last_run.get("started_at") if last_run else None,
            "last_status": last_run.get("status") if last_run else None,
            "last_result": last_run.get("metadata") if last_run else None,
        })

    return {"agents": agent_list}


@app.post("/agents/{agent_name}/run", response_model=JobResponse)
async def run_agent(agent_name: str, request: AgentRunRequest, background_tasks: BackgroundTasks):
    """
    Start an agent run.

    Returns immediately with a job_id that can be used to check status.
    """
    if agent_name not in agents:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")

    # Create job
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "agent": agent_name,
        "status": "queued",
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "result": None,
        "error": None,
    }

    # Start background task
    background_tasks.add_task(
        run_agent_job,
        job_id,
        agent_name,
        request.model_dump()
    )

    return JobResponse(**jobs[job_id])


@app.post("/agents/{agent_name}/run-sync")
async def run_agent_sync(agent_name: str, request: AgentRunRequest):
    """
    Run an agent synchronously and wait for completion.

    Use this for quick operations. For long-running agents, use /run instead.
    """
    if agent_name not in agents:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")

    agent = agents[agent_name]
    params = request.model_dump()

    try:
        if agent_name == "enrichment":
            result = await agent.run(
                athlete_id=params.get("athlete_ids", [None])[0] if params.get("athlete_ids") else None,
                batch_size=params.get("batch_size", 10)
            )
        elif agent_name == "research":
            result = await agent.run(
                sports=params.get("sports"),
                max_results=params.get("max_results", 20)
            )
        elif agent_name == "outreach":
            result = await agent.run(
                athlete_ids=params.get("athlete_ids"),
                campaign_id=params.get("campaign_id"),
                template=params.get("template")
            )
        elif agent_name == "scoring":
            result = await agent.run(
                athlete_ids=params.get("athlete_ids"),
                rescore=params.get("rescore", False)
            )
        else:
            raise HTTPException(status_code=400, detail=f"No handler for agent: {agent_name}")

        # Log to database
        try:
            db.client.table("agent_runs").insert({
                "agent_type": agent_name,
                "status": "completed",
                "records_processed": result.get("processed") or result.get("scored") or result.get("generated") or 0,
                "errors": result.get("failed", 0),
                "metadata": result
            }).execute()
        except Exception:
            pass

        return {
            "status": "completed",
            "agent": agent_name,
            "result": result
        }

    except Exception as e:
        # Log error
        try:
            db.client.table("agent_runs").insert({
                "agent_type": agent_name,
                "status": "failed",
                "errors": 1,
                "metadata": {"error": str(e)}
            }).execute()
        except Exception:
            pass

        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Get the status of a job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobResponse(**jobs[job_id])


@app.get("/jobs")
async def list_jobs(limit: int = 20):
    """List recent jobs."""
    sorted_jobs = sorted(
        jobs.values(),
        key=lambda x: x["started_at"],
        reverse=True
    )[:limit]

    return {"jobs": sorted_jobs}


class BulkEnrichRequest(BaseModel):
    """Request for bulk enrichment."""
    source: str = "instagram"
    limit: int = 50
    historical: bool = True


@app.post("/bulk-enrich")
async def bulk_enrich(request: BulkEnrichRequest, background_tasks: BackgroundTasks):
    """
    Bulk enrich athletes from a specific source.
    Primarily used to update profile pictures.
    """
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "agent": "bulk_enrich",
        "status": "queued",
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "result": None,
        "error": None,
        "progress": {"current": 0, "total": 0, "percent": 0, "message": "Starting..."},
    }

    background_tasks.add_task(
        run_bulk_enrich_job,
        job_id,
        request.source,
        request.limit,
        request.historical
    )

    return {"job_id": job_id, "status": "queued", "message": f"Bulk enriching from {request.source}"}


async def run_bulk_enrich_job(job_id: str, source: str, limit: int, historical: bool):
    """Run bulk enrichment in the background."""
    from backend.sources.instagram import InstagramScraper
    from backend.sources.onlyfans import OnlyFansScraper

    try:
        jobs[job_id]["status"] = "running"

        # Get athletes that need enrichment
        query = db.client.table("athletes").select(
            "id, name, instagram_handle, profile_pic_url, notes"
        )

        if historical:
            query = query.eq("is_historical", True)

        # Get those with instagram handles
        result = query.not_.is_("instagram_handle", "null").limit(limit).execute()
        athletes = result.data or []

        if not athletes:
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["result"] = {"processed": 0, "message": "No athletes to enrich"}
            jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()
            return

        total = len(athletes)
        jobs[job_id]["progress"] = {"current": 0, "total": total, "percent": 0, "message": f"Enriching {total} athletes from {source}..."}

        if source == "instagram":
            # Get all handles
            handles = [a["instagram_handle"] for a in athletes if a.get("instagram_handle")]
            handle_to_id = {a["instagram_handle"].lower(): a["id"] for a in athletes if a.get("instagram_handle")}

            # Scrape in batches
            scraper = InstagramScraper()
            results = scraper.scrape_profiles(handles, batch_size=25)

            updated = 0
            for username, data in results.items():
                athlete_id = handle_to_id.get(username.lower())
                if athlete_id and data.get("profile_pic"):
                    # Update athlete with profile pic and other data
                    update_data = {"profile_pic_url": data["profile_pic"]}

                    if data.get("followers"):
                        update_data["follower_count"] = data["followers"]

                    db.client.table("athletes").update(update_data).eq("id", athlete_id).execute()
                    updated += 1

                    # Update progress
                    jobs[job_id]["progress"] = {
                        "current": updated,
                        "total": total,
                        "percent": round((updated / total) * 100),
                        "message": f"Updated {updated}/{total}"
                    }

            jobs[job_id]["status"] = "completed"
            jobs[job_id]["result"] = {"processed": len(handles), "updated": updated}
            jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

        elif source == "onlyfans":
            import re
            # Get usernames - try OF username from notes first, then instagram handle
            usernames_to_scrape = []
            username_to_athlete_id = {}

            for athlete in athletes:
                of_username = None
                notes = athlete.get("notes", "") or ""

                # Try to extract OF username from notes
                if "of_username" in notes:
                    match = re.search(r'"of_username":\s*"([^"]+)"', notes)
                    if match:
                        of_username = match.group(1)

                # Fallback to instagram handle
                if not of_username:
                    of_username = athlete.get("instagram_handle")

                if of_username:
                    usernames_to_scrape.append(of_username)
                    username_to_athlete_id[of_username.lower()] = athlete["id"]

            if not usernames_to_scrape:
                jobs[job_id]["status"] = "completed"
                jobs[job_id]["result"] = {"processed": 0, "message": "No usernames to check"}
                jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()
                return

            # Scrape in batches
            scraper = OnlyFansScraper()
            results = scraper.scrape_profiles(usernames_to_scrape, batch_size=10)

            updated = 0
            found = 0
            for username, data in results.items():
                athlete_id = username_to_athlete_id.get(username.lower())
                if athlete_id and data.get("exists"):
                    found += 1
                    # Store enrichment data
                    try:
                        db.client.table("athlete_enrichment").upsert({
                            "athlete_id": athlete_id,
                            "data_source": "onlyfans",
                            "raw_data": data,
                        }, on_conflict="athlete_id,data_source").execute()
                        updated += 1
                    except Exception as e:
                        logger.error(
                            "Failed to upsert onlyfans enrichment for athlete %s: %s",
                            athlete_id, e,
                        )

                    # Update progress
                    jobs[job_id]["progress"] = {
                        "current": updated,
                        "total": total,
                        "percent": round((updated / total) * 100),
                        "message": f"Found {found} OF profiles, stored {updated}/{total}"
                    }

            jobs[job_id]["status"] = "completed"
            jobs[job_id]["result"] = {"processed": len(usernames_to_scrape), "found": found, "updated": updated}
            jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()


class SingleEnrichRequest(BaseModel):
    """Request to enrich a single athlete from a specific source."""
    athlete_id: str
    source: str


@app.post("/enrich-single")
async def enrich_single(request: SingleEnrichRequest):
    """
    Enrich a single athlete from a specific source.
    Sources: instagram, onlyfans, wikipedia, google, tiktok
    """
    from backend.sources.instagram import InstagramScraper
    from backend.sources.onlyfans import OnlyFansScraper

    try:
        # Get athlete
        result = db.client.table("athletes").select("*").eq("id", request.athlete_id).single().execute()
        athlete = result.data

        if not athlete:
            raise HTTPException(status_code=404, detail="Athlete not found")

        enrichment_result = {}

        if request.source == "instagram":
            handle = athlete.get("instagram_handle")
            if not handle:
                return {"success": False, "error": "No Instagram handle"}

            scraper = InstagramScraper()
            data = scraper.scrape_profile(handle)

            if data:
                update_data = {}
                if data.get("profile_pic"):
                    update_data["profile_pic_url"] = data["profile_pic"]
                if data.get("followers"):
                    update_data["follower_count"] = data["followers"]

                if update_data:
                    db.client.table("athletes").update(update_data).eq("id", request.athlete_id).execute()

                # Store full enrichment data
                try:
                    db.client.table("athlete_enrichment").upsert({
                        "athlete_id": request.athlete_id,
                        "data_source": "instagram",
                        "raw_data": data,
                    }, on_conflict="athlete_id,data_source").execute()
                except Exception as e:
                    logger.error(
                        "Failed to upsert instagram enrichment for athlete %s: %s",
                        request.athlete_id, e,
                    )

                enrichment_result = data

        elif request.source == "onlyfans":
            # Try to find OF username - check notes or use instagram handle as fallback
            of_username = None
            notes = athlete.get("notes", "") or ""

            # Try to extract OF username from notes
            if "of_username" in notes:
                import re
                match = re.search(r'"of_username":\s*"([^"]+)"', notes)
                if match:
                    of_username = match.group(1)

            # Fallback to instagram handle
            if not of_username:
                of_username = athlete.get("instagram_handle")

            if not of_username:
                return {"success": False, "error": "No OnlyFans username to check"}

            scraper = OnlyFansScraper()
            data = scraper.scrape_profile(of_username)

            if data and data.get("exists"):
                # Store full enrichment data
                try:
                    db.client.table("athlete_enrichment").upsert({
                        "athlete_id": request.athlete_id,
                        "data_source": "onlyfans",
                        "raw_data": data,
                    }, on_conflict="athlete_id,data_source").execute()
                except Exception as e:
                    logger.error(
                        "Failed to upsert onlyfans enrichment for athlete %s: %s",
                        request.athlete_id, e,
                    )

                enrichment_result = data
            else:
                enrichment_result = {"exists": False, "message": f"No OnlyFans profile found for {of_username}"}

        elif request.source == "google":
            # Google search enrichment (placeholder)
            enrichment_result = {"message": "Google enrichment not yet implemented"}

        elif request.source == "wikipedia":
            # Wikipedia enrichment (placeholder)
            enrichment_result = {"message": "Wikipedia enrichment not yet implemented"}

        elif request.source == "tiktok":
            # TikTok enrichment (placeholder)
            enrichment_result = {"message": "TikTok enrichment not yet implemented"}

        else:
            return {"success": False, "error": f"Unknown source: {request.source}"}

        return {
            "success": True,
            "source": request.source,
            "data": enrichment_result
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats")
async def get_stats():
    """Get agent run statistics."""
    try:
        # Get athlete counts
        athletes_result = db.client.table("athletes").select("id", count="exact").execute()

        # Get pending enrichment count
        pending_result = db.client.table("athletes").select("id", count="exact").eq(
            "enrichment_status", "pending"
        ).execute()

        # Get enriched count
        enriched_result = db.client.table("athletes").select("id", count="exact").eq(
            "enrichment_status", "enriched"
        ).execute()

        # Get recent agent runs
        runs_result = db.client.table("agent_runs").select("*").order(
            "started_at", desc=True
        ).limit(10).execute()

        return {
            "athletes": {
                "total": athletes_result.count or 0,
                "pending": pending_result.count or 0,
                "enriched": enriched_result.count or 0,
            },
            "recent_runs": runs_result.data or [],
        }
    except Exception as e:
        return {
            "athletes": {"total": 0, "pending": 0, "enriched": 0},
            "recent_runs": [],
            "error": str(e)
        }


# ==================== Pipeline scheduler control ====================

@app.get("/pipeline/scheduler/status")
async def pipeline_scheduler_status():
    """Status of the autonomous pipeline scheduler."""
    from backend.services.pipeline_scheduler import pipeline_scheduler
    return await pipeline_scheduler.get_status()


@app.post("/pipeline/scheduler/start")
async def pipeline_scheduler_start():
    """Start the autonomous pipeline scheduler."""
    from backend.services.pipeline_scheduler import pipeline_scheduler
    return await pipeline_scheduler.start()


@app.post("/pipeline/scheduler/stop")
async def pipeline_scheduler_stop():
    """Stop the autonomous pipeline scheduler."""
    from backend.services.pipeline_scheduler import pipeline_scheduler
    return await pipeline_scheduler.stop()


@app.post("/pipeline/scheduler/run-once")
async def pipeline_scheduler_run_once():
    """Run a single pipeline tick on demand (enrich → score → generate → send)."""
    from backend.services.pipeline_scheduler import pipeline_scheduler
    return await pipeline_scheduler.trigger_once()


if __name__ == "__main__":
    import uvicorn
    # Default to localhost; the API key check + reverse proxy handle exposure.
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=8000)
