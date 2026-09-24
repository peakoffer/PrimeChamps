export class ResearchPaidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchPaidOperationError";
  }
}

export function summarizeResearchPaidOperations(rows: Array<{
  status?: unknown;
  usage?: unknown;
  reserved_microusd?: unknown;
  settled_microusd?: unknown;
  estimated_microusd?: unknown;
}>) {
  return rows.reduce((summary, row) => {
    const reserved = Math.max(0, Number(row.reserved_microusd) || 0);
    const settled = row.settled_microusd == null ? null : Math.max(0, Number(row.settled_microusd) || 0);
    const usage = row.usage && typeof row.usage === "object" ? row.usage as Record<string, unknown> : {};
    const pricedUpperBound = row.status === "completed" && usage.billingBasis === "priced_usage_upper_bound"
      && row.estimated_microusd != null ? Math.max(0, Number(row.estimated_microusd) || 0) : null;
    const exposure = settled ?? pricedUpperBound ?? reserved;
    summary.settledMicrousd += settled ?? 0;
    summary.unsettledReservedMicrousd += settled === null ? exposure : 0;
    summary.estimatedMicrousd += Math.max(0, Number(row.estimated_microusd) || 0);
    summary.exposureMicrousd += exposure;
    summary.operations += 1;
    return summary;
  }, { settledMicrousd: 0, unsettledReservedMicrousd: 0, estimatedMicrousd: 0, exposureMicrousd: 0, operations: 0 });
}
