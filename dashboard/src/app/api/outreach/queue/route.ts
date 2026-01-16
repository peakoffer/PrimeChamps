import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// GET - Fetch outreach queue items
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "dms"; // 'dms', 'comments', 'sent'

    // Get athletes in reach_out stage with their messages
    let items: Array<{
      id: string;
      athlete_id: string;
      queue_type: string;
      content_preview: string;
      approval_status: string;
      auto_approved: boolean;
      created_at: string;
      athlete?: {
        id: string;
        name: string;
        sport: string;
        instagram_handle?: string;
        profile_pic_url?: string;
        follower_count?: number;
      };
      post_url?: string;
      post_caption_preview?: string;
    }> = [];

    if (type === "dms" || type === "sent") {
      // Fetch from outreach_messages
      const statusFilter = type === "sent"
        ? ["sent"]
        : ["pending", "approved"];

      const { data: messages, error } = await supabase
        .from("outreach_messages")
        .select(`
          id,
          athlete_id,
          message_content,
          approval_status,
          auto_approved,
          status,
          created_at,
          athletes (
            id,
            name,
            sport,
            instagram_handle,
            profile_pic_url,
            follower_count
          )
        `)
        .in("approval_status", statusFilter)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error fetching DM queue:", error);
      } else if (messages) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = messages.map((m: any) => {
          const athlete = m.athletes;
          return {
            id: m.id,
            athlete_id: m.athlete_id,
            queue_type: "dm",
            content_preview: m.message_content,
            approval_status: m.approval_status,
            auto_approved: m.auto_approved || false,
            created_at: m.created_at,
            athlete: athlete ? {
              id: athlete.id,
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle,
              profile_pic_url: athlete.profile_pic_url,
              follower_count: athlete.follower_count,
            } : undefined,
          };
        });
      }
    }

    if (type === "comments") {
      // Fetch from content_engagements table
      const { data: engagements, error } = await supabase
        .from("content_engagements")
        .select(`
          id,
          athlete_id,
          post_id,
          post_url,
          post_caption_preview,
          content,
          approval_status,
          status,
          created_at,
          athletes (
            id,
            name,
            sport,
            instagram_handle,
            profile_pic_url,
            follower_count
          )
        `)
        .eq("engagement_type", "comment")
        .in("approval_status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error fetching comments queue:", error);
      } else if (engagements) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = engagements.map((e: any) => {
          const athlete = e.athletes;
          return {
            id: e.id,
            athlete_id: e.athlete_id,
            queue_type: "comment",
            content_preview: e.content || "",
            approval_status: e.approval_status,
            auto_approved: false,
            created_at: e.created_at,
            post_url: e.post_url,
            post_caption_preview: e.post_caption_preview,
            athlete: athlete ? {
              id: athlete.id,
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle,
              profile_pic_url: athlete.profile_pic_url,
              follower_count: athlete.follower_count,
            } : undefined,
          };
        });
      }
    }

    // Calculate stats
    const { count: pendingDmsCount } = await supabase
      .from("outreach_messages")
      .select("*", { count: "exact", head: true })
      .eq("approval_status", "pending");

    const { count: pendingCommentsCount } = await supabase
      .from("content_engagements")
      .select("*", { count: "exact", head: true })
      .eq("approval_status", "pending")
      .eq("engagement_type", "comment");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: sentTodayCount } = await supabase
      .from("touchpoints")
      .select("*", { count: "exact", head: true })
      .gte("created_at", today.toISOString())
      .eq("direction", "outbound");

    return NextResponse.json({
      items,
      stats: {
        pendingDms: pendingDmsCount || 0,
        pendingComments: pendingCommentsCount || 0,
        sentToday: sentTodayCount || 0,
        responseRate: 0, // TODO: Calculate from responses
      },
    });
  } catch (error) {
    console.error("Error in outreach queue:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
