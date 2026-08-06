import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET - Get contract by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
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
      .eq("organization_id", user.organizationId)
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
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { id } = await params;
    const body = await request.json();
    const { data: existingContract, error: existingError } = await supabase
      .from("contracts")
      .select("monthly_guarantee,contract_duration_months,guaranteed_value,projected_revenue_share_value")
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existingContract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

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
      "currency",
      "guaranteed_value",
      "projected_revenue_share_value",
      "total_contract_value",
      "actual_revenue",
      "renewal_date",
      "acquisition_source",
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }
    const monthly = Number(updateData.monthly_guarantee ?? existingContract.monthly_guarantee ?? 0);
    const duration = Number(updateData.contract_duration_months ?? existingContract.contract_duration_months ?? 0);
    if (updateData.guaranteed_value === undefined && (updateData.monthly_guarantee !== undefined || updateData.contract_duration_months !== undefined)) {
      updateData.guaranteed_value = monthly * duration;
    }
    if (updateData.guaranteed_value !== undefined || updateData.projected_revenue_share_value !== undefined) {
      updateData.total_contract_value = Number(updateData.guaranteed_value ?? existingContract.guaranteed_value ?? 0)
        + Number(updateData.projected_revenue_share_value ?? existingContract.projected_revenue_share_value ?? 0);
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
      .eq("organization_id", user.organizationId)
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
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
