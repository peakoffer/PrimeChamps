import assert from "node:assert/strict";
import test from "node:test";
import { assertTerminalApifyReceipt, boundedApifyChargeMicrousd, boundedApifyDatasetReadPolicy, newApifyRunBlockReason } from "../src/lib/research/apify-spending-policy.ts";
import { apifyDefaultStorageDeletePaths, assertApifyAccountHeadroom, assertOwnedUnnamedApifyStorage, canRecoverApifyStorageForLog, verifiedApifyDefaultStorageDeletes } from "../src/lib/research/apify-storage-policy.ts";

test("new strict-budget actors remain blocked until post-run storage retention is bounded", () => {
  assert.match(newApifyRunBlockReason() || "", /retained.*storage/);
  assert.match(newApifyRunBlockReason() || "", /existing evidence can still be read/);
});

test("ABORTING and unknown are recoverable uncertainty, never terminal settled receipts", () => {
  for (const status of ["ABORTING", "READY", "RUNNING", undefined]) {
    assert.throws(() => assertTerminalApifyReceipt(status), { name: "ResearchPaidOperationError" });
  }
  for (const status of ["ABORTED", "TIMED-OUT", "FAILED", "SUCCEEDED"]) {
    assert.doesNotThrow(() => assertTerminalApifyReceipt(status));
  }
});

test("dataset transfer/read exposure is independent of actor charge and bounded by item count", () => {
  const read = boundedApifyDatasetReadPolicy(100);
  // 100 worst-case 9 MiB objects, JSON framing, both ordinary transfer rates,
  // and 100 dataset reads. No assumption that the actor bill includes this GET.
  assert.equal(read.maximumResponseBytes, 100 * (9 * 1024 * 1024 + 1) + 4096);
  assert.equal(read.maximumCostMicrousd, Math.ceil(read.maximumResponseBytes * 0.00025 + 40));
  assert.ok(read.estimatedCostMicrousd(1_000) < read.maximumCostMicrousd);
  assert.ok(read.estimatedCostMicrousd(read.maximumResponseBytes * 2) > read.maximumCostMicrousd);
  assert.ok(read.estimatedCostMicrousd(0) > 0);
});

test("unknown/unbounded item and charge limits fail closed", () => {
  for (const limit of [NaN, Infinity, 0, -1, 1.5, 1001]) assert.throws(() => boundedApifyDatasetReadPolicy(limit));
  for (const cap of [NaN, Infinity, 0, -1, 5.1]) assert.throws(() => boundedApifyChargeMicrousd(cap));
  assert.equal(boundedApifyChargeMicrousd(0.5), 500_000);
  assert.throws(() => boundedApifyDatasetReadPolicy(1).estimatedCostMicrousd(-1));
});

test("account watch preserves the shared $100 limit and stops well before it", () => {
  const account = { username: "commemorative_allegory", monthlyLimitUsd: 100, currentUsageUsd: 0, activeActorRuns: 0, retentionDays: 31 };
  assert.doesNotThrow(() => assertApifyAccountHeadroom(account, 0.5));
  assert.throws(() => assertApifyAccountHeadroom({ ...account, currentUsageUsd: 44.6 }, 0.5), /watch threshold/);
  assert.throws(() => assertApifyAccountHeadroom({ ...account, monthlyLimitUsd: 101 }, 0.5), /reviewed test policy/);
  assert.throws(() => assertApifyAccountHeadroom({ ...account, retentionDays: 32 }, 0.5), /reviewed test policy/);
  assert.throws(() => assertApifyAccountHeadroom({ ...account, currentUsageUsd: null }, 0.5), /unavailable/);
  assert.throws(() => assertApifyAccountHeadroom({ ...account, activeActorRuns: 1 }, 0.5), /already busy/);
  assert.throws(() => assertApifyAccountHeadroom({ ...account, username: "another_account" }, 0.5), /different account/);
});

test("storage cleanup targets only the three defaults of a known run", () => {
  assert.deepEqual(apifyDefaultStorageDeletePaths("run_12345"), [
    "/actor-runs/run_12345/dataset",
    "/actor-runs/run_12345/key-value-store",
    "/actor-runs/run_12345/request-queue",
  ]);
  for (const id of ["", "last", "../last", "user~store", "run/other"]) {
    assert.throws(() => apifyDefaultStorageDeletePaths(id), /exact owned run ID/);
  }
});

test("storage cleanup requires the exact unnamed storage owned by the exact run", () => {
  const storage = { id: "dataset_123", actRunId: "run_12345", name: null };
  assert.doesNotThrow(() => assertOwnedUnnamedApifyStorage(storage, "run_12345", "dataset_123"));
  assert.throws(() => assertOwnedUnnamedApifyStorage({ ...storage, id: "other" }, "run_12345", "dataset_123"));
  assert.throws(() => assertOwnedUnnamedApifyStorage({ ...storage, actRunId: "run_other" }, "run_12345", "dataset_123"));
  assert.throws(() => assertOwnedUnnamedApifyStorage({ ...storage, name: "shared" }, "run_12345", "dataset_123"));
  assert.throws(() => assertOwnedUnnamedApifyStorage({ ...storage, name: undefined }, "run_12345", "dataset_123"));
});

test("one unsafe default prevents deletion of every default", () => {
  const run = { id: "run_12345", defaultDatasetId: "dataset_123", defaultKeyValueStoreId: "store_123", defaultRequestQueueId: "queue_123" };
  const metadata = [
    { id: "dataset_123", actRunId: "run_12345", name: null },
    { id: "store_123", actRunId: "run_12345", name: null },
    { id: "queue_123", actRunId: "run_12345", name: null },
  ];
  assert.deepEqual(verifiedApifyDefaultStorageDeletes(run, metadata), apifyDefaultStorageDeletePaths(run.id));
  assert.deepEqual(verifiedApifyDefaultStorageDeletes(run, [null, metadata[1], metadata[2]]), apifyDefaultStorageDeletePaths(run.id).slice(1));
  assert.throws(() => verifiedApifyDefaultStorageDeletes(run, [metadata[0], metadata[1], { ...metadata[2], name: "shared" }]));
  assert.throws(() => verifiedApifyDefaultStorageDeletes({ ...run, defaultRequestQueueId: undefined }, metadata));
});

test("cron recovery waits for the exact evaluation log to finish its dataset read", () => {
  for (const status of ["completed", "error", "cancelled"]) {
    assert.equal(canRecoverApifyStorageForLog({ organization_id: "org_1", status, is_evaluation: true }, "org_1"), true);
  }
  for (const status of ["queued", "running"]) {
    assert.equal(canRecoverApifyStorageForLog({ organization_id: "org_1", status, is_evaluation: true }, "org_1"), false);
  }
  assert.equal(canRecoverApifyStorageForLog({ organization_id: "org_2", status: "completed", is_evaluation: true }, "org_1"), false);
  assert.equal(canRecoverApifyStorageForLog({ organization_id: "org_1", status: "completed", is_evaluation: false }, "org_1"), false);
});
