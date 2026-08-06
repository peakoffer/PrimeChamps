import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8000";

// Generate a personalized outreach message for an athlete
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const body = await request.json();
    const { athleteId } = body;

    if (!athleteId) {
      return NextResponse.json({ error: "Missing athleteId" }, { status: 400 });
    }

    // Fetch athlete data
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("*")
      .eq("id", athleteId)
      .eq("organization_id", user.organizationId)
      .single();

    if (athleteError || !athlete) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    // Try to call the Python agent server for AI-generated message
    try {
      const response = await fetch(`${AGENT_SERVER_URL}/outreach/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {}),
        },
        body: JSON.stringify({ athlete }),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({ message: data.message, source: "ai" });
      }
    } catch {
      // Python server not available, fall back to template
    }

    // Fallback: Generate a template-based message
    const message = generateTemplateMessage(athlete);
    return NextResponse.json({ message, source: "template" });

  } catch (error) {
    console.error("Error generating message:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}

interface Athlete {
  name: string;
  sport: string;
  instagram_handle?: string;
  follower_count?: number;
  notes?: string;
}

function generateTemplateMessage(athlete: Athlete): string {
  const firstName = athlete.name.split(" ")[0];
  const sport = athlete.sport || "your sport";

  // Parse notes for achievements if available
  let achievement = "";
  if (athlete.notes) {
    try {
      const notesData = JSON.parse(athlete.notes);
      if (notesData.achievements && notesData.achievements.length > 0) {
        achievement = notesData.achievements[0];
      }
    } catch {
      // Notes aren't JSON, that's fine
    }
  }

  const templates = [
    `Hey ${firstName}! I've been following your journey in ${sport} and I'm really impressed with what you've built. I work with athletes like yourself to create additional income streams through content platforms. Would love to chat if you're open to it!`,

    `Hi ${firstName}! Your work in ${sport} caught my attention${achievement ? ` - congrats on ${achievement}!` : "."} I help athletes monetize their personal brand and build sustainable income outside of competition. Let me know if you'd be interested in learning more!`,

    `${firstName}! Big fan of what you're doing in ${sport}. I partner with athletes to help them leverage their following into real revenue. No pressure, but if you're curious about how other athletes are doing it, I'd love to share some insights. What do you think?`,
  ];

  // Pick a random template
  const template = templates[Math.floor(Math.random() * templates.length)];
  return template;
}
