import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

// GET /api/messages - List messages with filters
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status"); // pending_approval, approved, sent, etc.
    const approvalStatus = searchParams.get("approval_status"); // pending, approved, rejected
    const sport = searchParams.get("sport");
    const search = searchParams.get("search");
    const sortBy = searchParams.get("sort_by") || "created_at";
    const sortOrder = searchParams.get("sort_order") || "desc";
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    let query = supabase
      .from("outreach_messages")
      .select("*, athletes!inner(*)", { count: "exact" });

    // Filter by message status
    if (status) {
      query = query.eq("status", status);
    }

    // Filter by approval status
    if (approvalStatus) {
      query = query.eq("approval_status", approvalStatus);
    }

    // Filter by sport (via athletes join)
    if (sport) {
      query = query.eq("athletes.sport", sport);
    }

    // Search by athlete name
    if (search) {
      query = query.ilike("athletes.name", `%${search}%`);
    }

    // Sorting
    const ascending = sortOrder === "asc";
    if (sortBy === "follower_count") {
      query = query.order("athletes(follower_count)", { ascending });
    } else if (sortBy === "athlete_name") {
      query = query.order("athletes(name)", { ascending });
    } else {
      query = query.order(sortBy, { ascending });
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("Error fetching messages:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      messages: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error in GET /api/messages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/messages - Create a new message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athlete_id, message_content, personalization_data, campaign_id } = body;

    if (!athlete_id || !message_content) {
      return NextResponse.json(
        { error: "athlete_id and message_content are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("outreach_messages")
      .insert({
        athlete_id,
        message_content,
        personalization_data: personalization_data || {},
        campaign_id: campaign_id || null,
        status: "pending_approval",
        approval_status: "pending",
      })
      .select("*, athletes(*)")
      .single();

    if (error) {
      console.error("Error creating message:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: data });
  } catch (error) {
    console.error("Error in POST /api/messages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
