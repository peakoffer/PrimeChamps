import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Get contract by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from("contracts")
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          profile_pic_url,
          follower_count
        ),
        appointments (
          id,
          scheduled_at,
          outcome,
          outcome_notes
        )
      `)
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ contract: data });
  } catch (error) {
    console.error("Error fetching contract:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PUT - Update contract
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      "status",
      "contract_type",
      "revenue_share_percent",
      "monthly_guarantee",
      "contract_duration_months",
      "start_date",
      "terms",
      "document_url",
      "notes",
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("contracts")
      .update(updateData)
      .eq("id", id)
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          profile_pic_url
        )
      `)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ contract: data, success: true });
  } catch (error) {
    console.error("Error updating contract:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
