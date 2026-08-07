import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsPeriodStart } from "@/lib/analytics/funnel";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const startDate = analyticsPeriodStart(request.nextUrl.searchParams.get("period") || "7d");
    const sport = request.nextUrl.searchParams.get("sport");

    let query = supabase
      .from("contracts")
      .select("status,signed_at,guaranteed_value,projected_revenue_share_value,total_contract_value,actual_revenue,athletes!inner(sport,organization_id,is_test_data)")
      .eq("organization_id", user.organizationId)
      .eq("is_test_data", false)
      .eq("athletes.organization_id", user.organizationId)
      .eq("athletes.is_test_data", false)
      .not("signed_at", "is", null);
    if (startDate) query = query.gte("signed_at", startDate);
    if (sport) query = query.eq("athletes.sport", sport);

    const { data, error } = await query;
    if (error) throw error;
    const contracts = data || [];
    const totals = contracts.reduce((sum, contract) => ({
      guaranteed: sum.guaranteed + Number(contract.guaranteed_value || 0),
      projectedRevenueShare: sum.projectedRevenueShare + Number(contract.projected_revenue_share_value || 0),
      projected: sum.projected + Number(contract.total_contract_value || 0),
      actual: sum.actual + Number(contract.actual_revenue || 0),
    }), { guaranteed: 0, projectedRevenueShare: 0, projected: 0, actual: 0 });

    return NextResponse.json({
      signed_contracts: contracts.length,
      guaranteed_value: totals.guaranteed,
      projected_revenue_share_value: totals.projectedRevenueShare,
      projected_contract_value: totals.projected,
      actual_revenue: totals.actual,
      average_contract_value: contracts.length ? totals.projected / contracts.length : 0,
      realization_rate: totals.projected > 0 ? totals.actual / totals.projected : 0,
      definition: "Signed deals for athletes in this view.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load contract economics";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authenticated" ? 401 : 500 }
    );
  }
}
