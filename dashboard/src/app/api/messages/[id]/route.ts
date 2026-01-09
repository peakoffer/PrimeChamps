import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/messages/[id] - Get a single message
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const { data, error } = await supabase
      .from("outreach_messages")
      .select("*, athletes(*)")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching message:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({ message: data });
  } catch (error) {
    console.error("Error in GET /api/messages/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PUT /api/messages/[id] - Update a message
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { message_content, personalization_data } = body;

    if (!message_content) {
      return NextResponse.json(
        { error: "message_content is required" },
        { status: 400 }
      );
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      message_content,
    };

    if (personalization_data !== undefined) {
      updateData.personalization_data = personalization_data;
    }

    const { data, error } = await supabase
      .from("outreach_messages")
      .update(updateData)
      .eq("id", id)
      .select("*, athletes(*)")
      .single();

    if (error) {
      console.error("Error updating message:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: data });
  } catch (error) {
    console.error("Error in PUT /api/messages/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE /api/messages/[id] - Delete a message
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const { error } = await supabase
      .from("outreach_messages")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting message:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in DELETE /api/messages/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
