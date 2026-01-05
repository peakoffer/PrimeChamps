import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Agent definitions
const AGENTS = [
  {
    id: "enrichment",
    name: "Enrichment Agent",
    description: "Enriches athlete data from Instagram via Apify",
    icon: "📊",
  },
  {
    id: "scoring",
    name: "Scoring Agent",
    description: "Scores and prioritizes athletes for outreach",
    icon: "🎯",
  },
  {
    id: "research",
    name: "Research Agent",
    description: "Discovers new athletes from web sources",
    icon: "🔍",
  },
  {
    id: "outreach",
    name: "Outreach Agent",
    description: "Generates personalized outreach messages",
    icon: "✉️",
  },
];

// GET - Get agent statuses and recent runs
export async function GET() {
  try {
    // Check if agent_runs table exists by trying to query it
    const { error: tableError } = await supabase
      .from("agent_runs")
      .select("id")
      .limit(1);

    // If table doesn't exist, return agents without stats
    if (tableError && (tableError.code === "PGRST205" || tableError.message.includes("does not exist") || tableError.message.includes("schema cache"))) {
      const agentStats = AGENTS.map((agent) => ({
        ...agent,
        lastRun: null,
        stats: {
          totalRuns: 0,
          successfulRuns: 0,
          successRate: 0,
          totalRecords: 0,
        },
      }));

      return NextResponse.json({
        agents: agentStats,
        migrationNeeded: true,
        message: "Run migration_v2_agents.sql in Supabase SQL Editor",
      });
    }

    // Get last run for each agent
    const agentStats = await Promise.all(
      AGENTS.map(async (agent) => {
        const { data: lastRun } = await supabase
          .from("agent_runs")
          .select("*")
          .eq("agent_type", agent.id)
          .order("started_at", { ascending: false })
          .limit(1)
          .single();

        // Get total runs and success rate
        const { data: allRuns } = await supabase
          .from("agent_runs")
          .select("status, records_processed, records_success")
          .eq("agent_type", agent.id);

        const totalRuns = allRuns?.length || 0;
        const successfulRuns = allRuns?.filter((r) => r.status === "completed").length || 0;
        const totalRecords = allRuns?.reduce((sum, r) => sum + (r.records_processed || 0), 0) || 0;

        return {
          ...agent,
          lastRun: lastRun || null,
          stats: {
            totalRuns,
            successfulRuns,
            successRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0,
            totalRecords,
          },
        };
      })
    );

    return NextResponse.json({ agents: agentStats });
  } catch (error) {
    console.error("Error fetching agents:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Python agent server URL
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8000";

// POST - Start an agent run (async with job tracking)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, options = {}, sync = false } = body;

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    const agent = AGENTS.find((a) => a.id === agentId);
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    }

    // Call the Python agent server
    try {
      // Use sync endpoint for quick operations, async for long-running
      const endpoint = sync
        ? `${AGENT_SERVER_URL}/agents/${agentId}/run-sync`
        : `${AGENT_SERVER_URL}/agents/${agentId}/run`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server returned ${response.status}`);
      }

      const result = await response.json();

      // For async runs, return job_id for polling
      if (!sync && result.job_id) {
        return NextResponse.json({
          success: true,
          message: `${agent.name} started`,
          job_id: result.job_id,
          status: result.status,
        });
      }

      return NextResponse.json({
        success: true,
        message: `${agent.name} completed`,
        result: result.result,
        status: result.status,
      });

    } catch (fetchError) {
      // If Python server is not running, provide helpful error
      if (fetchError instanceof TypeError && fetchError.message.includes("fetch")) {
        return NextResponse.json({
          error: "Agent server not running",
          serverRequired: true,
          instructions: "Start the agent server with: python -m backend.server",
        }, { status: 503 });
      }

      throw fetchError;
    }

  } catch (error) {
    console.error("Error starting agent:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET server health
export async function HEAD() {
  try {
    const response = await fetch(`${AGENT_SERVER_URL}/health`);
    if (response.ok) {
      return new NextResponse(null, { status: 200 });
    }
    return new NextResponse(null, { status: 503 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
