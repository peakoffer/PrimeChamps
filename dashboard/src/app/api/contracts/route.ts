import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET - List contracts with optional filters
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get("athlete_id");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase
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
          outcome
        )
      `)
      .eq("organization_id", user.organizationId)
      .eq("is_test_data", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (athleteId) {
      query = query.eq("athlete_id", athleteId);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({ contracts: data || [] });
  } catch (error) {
    console.error("Error fetching contracts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", contracts: [] },
      { status: 500 }
    );
  }
}

// POST - Create a new contract
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const body = await request.json();
    const {
      athlete_id,
      appointment_id,
      contract_type = "standard",
      revenue_share_percent,
      monthly_guarantee,
      contract_duration_months,
      start_date,
      terms,
      notes,
      currency = "USD",
      guaranteed_value,
      projected_revenue_share_value,
      actual_revenue,
      renewal_date,
      acquisition_source,
    } = body;

    if (!athlete_id) {
      return NextResponse.json(
        { error: "athlete_id is required" },
        { status: 400 }
      );
    }

    // Verify athlete exists
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("id, name")
      .eq("id", athlete_id)
      .eq("organization_id", user.organizationId)
      .single();

    if (athleteError || !athlete) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    const normalizedMonthlyGuarantee = monthly_guarantee == null ? null : Number(monthly_guarantee);
    const normalizedDuration = contract_duration_months == null ? null : Number(contract_duration_months);
    const guaranteedValue = guaranteed_value == null
      ? (normalizedMonthlyGuarantee || 0) * (normalizedDuration || 0)
      : Number(guaranteed_value);
    const projectedRevenueShareValue = Number(projected_revenue_share_value || 0);
    const totalContractValue = guaranteedValue + projectedRevenueShareValue;

    const { data, error } = await supabase
      .from("contracts")
      .insert({
        organization_id: user.organizationId,
        athlete_id,
        appointment_id,
        contract_type,
        revenue_share_percent,
        monthly_guarantee: normalizedMonthlyGuarantee,
        contract_duration_months: normalizedDuration,
        start_date,
        terms: terms || {},
        notes,
        status: "draft",
        currency: String(currency).toUpperCase(),
        guaranteed_value: guaranteedValue,
        projected_revenue_share_value: projectedRevenueShareValue,
        total_contract_value: totalContractValue,
        actual_revenue: actual_revenue == null ? null : Number(actual_revenue),
        renewal_date: renewal_date || null,
        acquisition_source: acquisition_source || null,
        is_test_data: false,
      })
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
      throw error;
    }

    return NextResponse.json({ contract: data, success: true });
  } catch (error) {
    console.error("Error creating contract:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
