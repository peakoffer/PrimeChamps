import assert from "node:assert/strict";
import test from "node:test";
import { assertTerminalApifyReceipt, boundedApifyChargeMicrousd, boundedApifyDatasetReadPolicy, newApifyRunBlockReason } from "../src/lib/research/apify-spending-policy.ts";

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
