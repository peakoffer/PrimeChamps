import { ResearchPaidOperationError } from "./paid-operation-policy.ts";

export type ActorBillingMetadata = {
  pricingInfos?: Array<{
    startedAt?: string;
    pricingModel?: string;
    minimalMaxTotalChargeUsd?: number | null;
  }>;
  taggedBuilds?: Record<string, { buildId?: string; buildNumber?: string }>;
};

// Reviewed 2026-09-24. These bound a plain JSON items GET, not retention fees.
// https://docs.apify.com/storage/dataset#limits (<9 MB per JSON object)
// https://apify.com/pricing (dataset reads and external/internal transfer)
const MAX_DATASET_ITEM_BYTES = 9 * 1_024 * 1_024;
const JSON_RESPONSE_ALLOWANCE_BYTES = 4_096;
const TRANSFER_MICROUSD_PER_BYTE = 250_000 / 1_000_000_000;
const DATASET_READ_MICROUSD_PER_ITEM = 0.4;

export function boundedApifyChargeMicrousd(requestedUsd: number) {
  if (!Number.isFinite(requestedUsd) || requestedUsd <= 0 || requestedUsd > 5) {
    throw new Error("Apify research charge cap must be greater than zero and at most $5");
  }
  return Math.ceil(requestedUsd * 1_000_000);
}

/** No configuration flag may bypass an unresolved provider billing boundary. */
export function newApifyRunBlockReason(): string | null {
  return "Strict-budget Apify starts are blocked: maxTotalChargeUsd bounds a run, but retained dataset/key-value/request-queue storage can be charged afterward. A reviewed retention policy is required before new actors can run; existing evidence can still be read.";
}

/** Never mark ABORTING/unknown as completed: preserve the remote ID for recovery. */
export function assertTerminalApifyReceipt(status: string | undefined) {
  if (!["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(status || "")) {
    throw new ResearchPaidOperationError(`Apify run is still ${status || "unknown"}; its full reservation and remote ID remain held for reconciliation`);
  }
}

export function boundedApifyDatasetReadPolicy(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Strict Apify dataset reads require an explicit integer limit between 1 and 1000");
  }
  // No CSV/XML, flatten, unwind, or other expansion transforms are permitted.
  // Include an extra byte per item for JSON separators and both transfer rates.
  const maximumResponseBytes = limit * (MAX_DATASET_ITEM_BYTES + 1) + JSON_RESPONSE_ALLOWANCE_BYTES;
  const price = (responseBytes: number) => Math.ceil(
    responseBytes * TRANSFER_MICROUSD_PER_BYTE + limit * DATASET_READ_MICROUSD_PER_ITEM,
  );
  return {
    limit,
    maximumResponseBytes,
    maximumCostMicrousd: price(maximumResponseBytes),
    estimatedCostMicrousd(responseBytes: number) {
      if (!Number.isSafeInteger(responseBytes) || responseBytes < 0) throw new Error("Invalid Apify dataset response byte count");
      // Retain a framing allowance even for tiny/empty results. This is an
      // estimated upper charge, never a provider-reported invoice amount.
      return price(responseBytes + JSON_RESPONSE_ALLOWANCE_BYTES);
    },
  };
}

/** Never confuse a dataset read limit with a provider-enforced spending limit. */
export function boundedActorPolicy(metadata: ActorBillingMetadata, requestedUsd = 0.5, now = Date.now()) {
  const pricing = (metadata.pricingInfos || [])
    .filter((item) => Number.isFinite(Date.parse(item.startedAt || "")) && Date.parse(item.startedAt!) <= now)
    .sort((a, b) => Date.parse(b.startedAt!) - Date.parse(a.startedAt!))[0];
  if (pricing?.pricingModel !== "PAY_PER_EVENT") {
    throw new Error("Strict research accounting requires an Apify pay-per-event Actor with a provider-enforced charge cap");
  }
  const maximumCostMicrousd = boundedApifyChargeMicrousd(requestedUsd);
  const minimum = pricing.minimalMaxTotalChargeUsd ?? 0;
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > requestedUsd) {
    throw new Error("Actor minimum charge exceeds this operation's approved maximum; no run started");
  }
  const build = metadata.taggedBuilds?.latest;
  if (!build?.buildNumber || !build.buildId) throw new Error("Actor build could not be pinned before paid work");
  return { maximumCostMicrousd, chargeCapUsd: requestedUsd,
    buildNumber: build.buildNumber, buildId: build.buildId, pricingModel: pricing.pricingModel };
}
