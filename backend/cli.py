#!/usr/bin/env python3
"""
Prime Champs CLI - Command line interface for managing the system.

Usage:
    python -m backend.cli athletes list
    python -m backend.cli athletes show <id>
    python -m backend.cli enrich --all
    python -m backend.cli research --sport "Swimming"
    python -m backend.cli outreach generate
"""

import asyncio
import typer
from rich.console import Console
from rich.table import Table
from typing import Optional

from backend.database import db, EnrichmentStatus
from backend.agents import EnrichmentAgent, ResearchAgent, OutreachAgent, ScoringAgent

app = typer.Typer(help="Prime Champs CLI")
console = Console()

# Sub-apps
athletes_app = typer.Typer(help="Manage athletes")
app.add_typer(athletes_app, name="athletes")


# ==================== Athletes Commands ====================

@athletes_app.command("list")
def list_athletes(
    sport: Optional[str] = typer.Option(None, help="Filter by sport"),
    status: Optional[str] = typer.Option(None, help="Filter by enrichment status"),
    limit: int = typer.Option(50, help="Max results")
):
    """List all athletes in the database."""
    enrichment_status = None
    if status:
        try:
            enrichment_status = EnrichmentStatus(status)
        except ValueError:
            console.print(f"[red]Invalid status: {status}[/red]")
            raise typer.Exit(1)

    athletes = db.list_athletes(sport=sport, enrichment_status=enrichment_status, limit=limit)

    if not athletes:
        console.print("[yellow]No athletes found.[/yellow]")
        return

    table = Table(title=f"Athletes ({len(athletes)} found)")
    table.add_column("Name", style="cyan")
    table.add_column("Sport", style="green")
    table.add_column("Instagram", style="blue")
    table.add_column("Status", style="magenta")
    table.add_column("Email", style="dim")

    for a in athletes:
        table.add_row(
            a["name"],
            a["sport"],
            f"@{a.get('instagram_handle', 'N/A')}",
            a.get("enrichment_status", "pending"),
            a.get("email", "—")[:30] if a.get("email") else "—"
        )

    console.print(table)


@athletes_app.command("show")
def show_athlete(athlete_id: str):
    """Show details for a specific athlete."""
    athlete = db.get_athlete(athlete_id)

    if not athlete:
        console.print(f"[red]Athlete not found: {athlete_id}[/red]")
        raise typer.Exit(1)

    console.print(f"\n[bold cyan]{athlete['name']}[/bold cyan]")
    console.print(f"  Sport: {athlete['sport']}")
    console.print(f"  Instagram: @{athlete.get('instagram_handle', 'N/A')}")
    console.print(f"  Email: {athlete.get('email', 'N/A')}")
    console.print(f"  Followers: {athlete.get('follower_count', 'Unknown')}")
    console.print(f"  Status: {athlete.get('enrichment_status', 'pending')}")
    console.print(f"  Source: {athlete.get('source', 'unknown')}")
    console.print(f"  Notes: {athlete.get('notes', '—')}")

    # Get enrichment data
    enrichments = db.get_athlete_enrichment(athlete_id)
    if enrichments:
        console.print(f"\n[bold]Enrichment Data ({len(enrichments)} sources):[/bold]")
        for e in enrichments:
            console.print(f"  - {e['data_source']} ({e['enriched_at'][:10]})")


@athletes_app.command("stats")
def athlete_stats():
    """Show athlete statistics."""
    all_athletes = db.list_athletes(limit=1000)

    if not all_athletes:
        console.print("[yellow]No athletes in database.[/yellow]")
        return

    # Calculate stats
    by_sport = {}
    by_status = {}

    for a in all_athletes:
        sport = a.get("sport", "Unknown")
        status = a.get("enrichment_status", "pending")

        by_sport[sport] = by_sport.get(sport, 0) + 1
        by_status[status] = by_status.get(status, 0) + 1

    console.print(f"\n[bold]Total Athletes: {len(all_athletes)}[/bold]\n")

    console.print("[bold]By Sport:[/bold]")
    for sport, count in sorted(by_sport.items(), key=lambda x: -x[1]):
        console.print(f"  {sport}: {count}")

    console.print("\n[bold]By Status:[/bold]")
    for status, count in by_status.items():
        console.print(f"  {status}: {count}")


# ==================== Enrichment Commands ====================

@app.command("enrich")
def run_enrichment(
    athlete_id: Optional[str] = typer.Option(None, help="Specific athlete to enrich"),
    all_pending: bool = typer.Option(False, "--all", help="Enrich all pending athletes"),
    batch_size: int = typer.Option(10, help="Batch size for bulk enrichment")
):
    """Run the enrichment agent."""
    if not athlete_id and not all_pending:
        console.print("[red]Specify --all or provide an athlete ID[/red]")
        raise typer.Exit(1)

    agent = EnrichmentAgent()

    with console.status("[bold green]Running enrichment..."):
        results = asyncio.run(agent.run(
            athlete_id=athlete_id,
            batch_size=batch_size
        ))

    console.print(f"\n[bold]Enrichment Results:[/bold]")
    console.print(f"  Processed: {results['processed']}")
    console.print(f"  Success: {results['success']}")
    console.print(f"  Failed: {results['failed']}")


# ==================== Research Commands ====================

@app.command("research")
def run_research(
    sport: Optional[str] = typer.Option(None, help="Specific sport to research"),
    max_results: int = typer.Option(20, help="Maximum athletes to discover")
):
    """Run the research agent to discover new athletes."""
    agent = ResearchAgent()

    sports = [sport] if sport else None

    with console.status("[bold green]Researching new athletes..."):
        results = asyncio.run(agent.run(
            sports=sports,
            max_results=max_results
        ))

    console.print(f"\n[bold]Research Results:[/bold]")
    console.print(f"  Sports searched: {results['searched']}")
    console.print(f"  Discovered: {results['discovered']}")
    console.print(f"  Added: {results['added']}")
    console.print(f"  Duplicates: {results['duplicates']}")


# ==================== Scoring Commands ====================

@app.command("score")
def run_scoring(
    athlete_id: Optional[str] = typer.Option(None, help="Specific athlete to score"),
    all_enriched: bool = typer.Option(False, "--all", help="Score all enriched athletes"),
    rescore: bool = typer.Option(False, "--rescore", help="Rescore even if already scored"),
    top: int = typer.Option(0, "--top", help="Show top N leads after scoring")
):
    """Run the scoring agent to prioritize leads."""
    if not athlete_id and not all_enriched:
        console.print("[red]Specify --all or provide an athlete ID[/red]")
        raise typer.Exit(1)

    agent = ScoringAgent()

    with console.status("[bold green]Scoring athletes..."):
        if athlete_id:
            result = asyncio.run(agent.score_single(athlete_id))
            if "error" in result:
                console.print(f"[red]{result['error']}[/red]")
                raise typer.Exit(1)
            console.print(f"\n[bold]{result['name']}[/bold]")
            console.print(f"  Score: {result['score']} ({result['tier'].upper()})")
            console.print(f"  Factors:")
            for factor, points in result['factors'].items():
                if points > 0:
                    console.print(f"    {factor}: +{points}")
        else:
            results = asyncio.run(agent.run(rescore=rescore))
            console.print(f"\n[bold]Scoring Results:[/bold]")
            console.print(f"  Scored: {results['scored']}")
            console.print(f"  Skipped: {results['skipped']}")
            console.print(f"  Failed: {results['failed']}")

    if top > 0:
        console.print(f"\n[bold]Top {top} Leads:[/bold]")
        leads = agent.get_top_leads(limit=top)
        table = Table()
        table.add_column("Name", style="cyan")
        table.add_column("Sport", style="green")
        table.add_column("Score", style="bold yellow")
        table.add_column("Tier", style="magenta")
        table.add_column("Followers", style="dim")

        for lead in leads:
            athlete = lead.get("athletes", {})
            tier_color = {"hot": "red", "warm": "yellow", "cold": "blue"}.get(lead["tier"], "white")
            table.add_row(
                athlete.get("name", "Unknown"),
                athlete.get("sport", "Unknown"),
                str(lead["score"]),
                f"[{tier_color}]{lead['tier'].upper()}[/{tier_color}]",
                str(athlete.get("follower_count", "N/A"))
            )

        console.print(table)


@app.command("leads")
def show_leads(
    tier: Optional[str] = typer.Option(None, help="Filter by tier (hot, warm, cold)"),
    limit: int = typer.Option(20, help="Max results")
):
    """Show top scored leads."""
    agent = ScoringAgent()
    leads = agent.get_top_leads(limit=limit, tier=tier)

    if not leads:
        console.print("[yellow]No scored leads found. Run 'score --all' first.[/yellow]")
        return

    table = Table(title=f"Top Leads ({len(leads)} shown)")
    table.add_column("Name", style="cyan")
    table.add_column("Sport", style="green")
    table.add_column("Score", style="bold yellow")
    table.add_column("Tier", style="magenta")
    table.add_column("Followers", style="dim")
    table.add_column("Instagram", style="blue")

    for lead in leads:
        athlete = lead.get("athletes", {})
        tier_color = {"hot": "red", "warm": "yellow", "cold": "blue"}.get(lead["tier"], "white")
        table.add_row(
            athlete.get("name", "Unknown"),
            athlete.get("sport", "Unknown"),
            str(lead["score"]),
            f"[{tier_color}]{lead['tier'].upper()}[/{tier_color}]",
            str(athlete.get("follower_count", "N/A")),
            f"@{athlete.get('instagram_handle', 'N/A')}"
        )

    console.print(table)


# ==================== Outreach Commands ====================

@app.command("outreach")
def run_outreach(
    generate: bool = typer.Option(False, "--generate", help="Generate new messages"),
    send: bool = typer.Option(False, "--send", help="Send approved messages"),
    athlete_id: Optional[str] = typer.Option(None, help="Generate for specific athlete")
):
    """Manage outreach messages."""
    if not generate and not send:
        # Show pending approvals
        pending = db.get_pending_approvals()

        if not pending:
            console.print("[yellow]No messages pending approval.[/yellow]")
            return

        table = Table(title=f"Messages Pending Approval ({len(pending)})")
        table.add_column("Athlete", style="cyan")
        table.add_column("Preview", style="dim", max_width=50)
        table.add_column("Created", style="green")

        for msg in pending:
            athlete = msg.get("athletes", {})
            preview = msg["message_content"][:100] + "..." if len(msg["message_content"]) > 100 else msg["message_content"]
            table.add_row(
                athlete.get("name", "Unknown"),
                preview.replace("\n", " "),
                msg["created_at"][:10]
            )

        console.print(table)
        return

    agent = OutreachAgent()

    if generate:
        with console.status("[bold green]Generating outreach messages..."):
            athlete_ids = [athlete_id] if athlete_id else None
            results = asyncio.run(agent.run(athlete_ids=athlete_ids))

        console.print(f"\n[bold]Generation Results:[/bold]")
        console.print(f"  Generated: {results['generated']}")
        console.print(f"  Failed: {results.get('failed', 0)}")

    if send:
        with console.status("[bold green]Sending approved messages..."):
            results = asyncio.run(agent.send_approved_messages())

        console.print(f"\n[bold]Send Results:[/bold]")
        console.print(f"  Sent: {results['sent']}")
        console.print(f"  Failed: {results.get('failed', 0)}")


# ==================== Utility Commands ====================

@app.command("status")
def system_status():
    """Show system status and statistics."""
    console.print("\n[bold cyan]Prime Champs System Status[/bold cyan]\n")

    try:
        # Test database connection
        athletes = db.list_athletes(limit=1)
        console.print("[green]✓[/green] Database connected")

        # Get counts
        all_athletes = db.list_athletes(limit=10000)
        pending = db.get_pending_approvals()

        console.print(f"\n[bold]Statistics:[/bold]")
        console.print(f"  Athletes: {len(all_athletes)}")
        console.print(f"  Pending enrichment: {len([a for a in all_athletes if a.get('enrichment_status') == 'pending'])}")
        console.print(f"  Messages pending approval: {len(pending)}")

    except Exception as e:
        console.print(f"[red]✗[/red] Database error: {str(e)}")


if __name__ == "__main__":
    app()
