import { ResearchPaidOperationError } from "./paid-operation-policy.ts";

export type ApifyAccountWatch = {
  username: string;
  monthlyLimitUsd: number | null;
  currentUsageUsd: number | null;
  activeActorRuns: number | null;
  retentionDays: number | null;
};

/** Secondary account-wide stop; the per-campaign operation ledger remains authoritative. */
export function assertApifyAccountHeadroom(account: ApifyAccountWatch, actorChargeCapUsd: number) {
  const { monthlyLimitUsd, currentUsageUsd, activeActorRuns, retentionDays } = account;
  if (account.username !== "commemorative_allegory") {
    throw new ResearchPaidOperationError("Apify key belongs to a different account; no Actor started");
  }
  if (![monthlyLimitUsd, currentUsageUsd, activeActorRuns, retentionDays, actorChargeCapUsd]
    .every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new ResearchPaidOperationError("Apify usage or retention is unavailable; no Actor started");
  }
  if (monthlyLimitUsd! <= 0 || monthlyLimitUsd! > 100 || retentionDays! < 0 || retentionDays! > 31) {
    throw new ResearchPaidOperationError("Apify account limit or retention differs from the reviewed test policy; no Actor started");
  }
  if (currentUsageUsd! < 0 || activeActorRuns! !== 0 || actorChargeCapUsd <= 0) {
    throw new ResearchPaidOperationError("Apify account is already busy or its usage is invalid; no Actor started");
  }
  // Leave $5 for storage/usage posting lag, even if the account's own limit is $100.
  if (currentUsageUsd! + actorChargeCapUsd + 5 > Math.min(50, monthlyLimitUsd!)) {
    throw new ResearchPaidOperationError("Apify account usage reached the $50 research watch threshold; no Actor started");
  }
}

/** Only run IDs from our completed, ledger-owned evaluation operations may be used. */
export function apifyDefaultStorageDeletePaths(runId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(runId)) {
    throw new ResearchPaidOperationError("Cannot clean Apify storage without an exact owned run ID");
  }
  const base = `/actor-runs/${encodeURIComponent(runId)}`;
  return [`${base}/dataset`, `${base}/key-value-store`, `${base}/request-queue`] as const;
}

export function assertOwnedUnnamedApifyStorage(
  metadata: unknown,
  runId: string,
  expectedStorageId: string,
) {
  if (!expectedStorageId || typeof metadata !== "object" || metadata === null) {
    throw new ResearchPaidOperationError("Apify test storage ownership could not be verified; no storage deleted");
  }
  const storage = metadata as Record<string, unknown>;
  if (storage.id !== expectedStorageId || storage.actRunId !== runId || storage.name !== null) {
    throw new ResearchPaidOperationError("Apify test storage is named, shared, or belongs to another run; no storage deleted");
  }
}

/** Verify all three defaults before permitting any deletion, never a named/shared store. */
export function verifiedApifyDefaultStorageDeletes(
  run: { id?: string; defaultDatasetId?: string; defaultKeyValueStoreId?: string; defaultRequestQueueId?: string },
  metadata: readonly (unknown | null)[],
) {
  const paths = apifyDefaultStorageDeletePaths(run.id || "");
  const ids = [run.defaultDatasetId, run.defaultKeyValueStoreId, run.defaultRequestQueueId];
  if (metadata.length !== paths.length || ids.some((id) => typeof id !== "string" || !id)) {
    throw new ResearchPaidOperationError("Apify test storage receipt is incomplete; no storage deleted");
  }
  return paths.filter((path, index) => {
    if (metadata[index] === null) return false; // Already gone: idempotent cleanup.
    assertOwnedUnnamedApifyStorage(metadata[index], run.id!, ids[index]!);
    return true;
  });
}

/** A terminal Actor alone is insufficient: the workflow may still be reading its dataset. */
export function canRecoverApifyStorageForLog(
  log: { organization_id?: string; status?: string; is_evaluation?: boolean },
  organizationId: string,
) {
  return log.organization_id === organizationId && log.is_evaluation === true
    && ["completed", "error", "cancelled"].includes(log.status || "");
}
