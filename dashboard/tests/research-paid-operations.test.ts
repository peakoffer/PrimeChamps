import assert from "node:assert/strict";
import test from "node:test";
import { createResearchPaidRuntime, paidOperationInputHash, summarizeResearchPaidOperations } from "../src/lib/research/paid-operation-core.ts";

function harness(options: { enabled?: boolean; limit?: number } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  let cancelled = false;
  let nextId = 0;
  const runtime = createResearchPaidRuntime({
    async call(request) {
      if (request.action === "scope") return { enabled: options.enabled !== false, organization_id: "org" };
      if (["reserve", "start", "guard"].includes(String(request.action)) && cancelled) throw new Error("cancelled");
      if (request.action === "guard") return { allowed: true };
      if (request.action === "reserve") {
        const key = `${request.research_log_id}/${request.operation_key}`;
        const prior = rows.get(key);
        if (prior?.status === "completed") return { mode: "cached", raw_response: prior.raw_response };
        if (prior?.status === "ambiguous" && prior.remote_request_id && request.can_resume) {
          prior.status = "reserved";
          return { mode: "resume", operation_id: prior.id, remote_request_id: prior.remote_request_id };
        }
        if (prior) throw new Error("in flight or ambiguous");
        if (summarizeResearchPaidOperations([...rows.values()]).exposureMicrousd + Number(request.maximum_cost_microusd) > (options.limit ?? 100)) throw new Error("budget");
        const row = { id: String(++nextId), status: "reserved", reserved_microusd: request.maximum_cost_microusd };
        rows.set(key, row);
        return { mode: "execute", operation_id: row.id };
      }
      const row = [...rows.values()].find((item) => item.id === request.operation_id)!;
      if (request.action === "start") row.status = "executing";
      if (request.action === "remote") { row.remote_request_id = request.remote_request_id; row.status = "remote_running"; }
      if (request.action === "checkpoint") Object.assign(row, { raw_response: request.raw_response, usage: request.usage });
      if (request.action === "complete") Object.assign(row, {
        status: "completed", raw_response: request.raw_response, usage: request.usage,
        settled_microusd: request.settled_cost_microusd, estimated_microusd: request.estimated_cost_microusd,
      });
      if (request.action === "ambiguous" && row.status !== "completed") row.status = "ambiguous";
      return {};
    },
  });
  return { ...runtime, rows, cancel: () => { cancelled = true; } };
}

const request = { provider: "test", modelOrActor: "frozen-v1", input: { candidate: "one" }, maximumCostMicrousd: 40 };

test("persisted malformed response and usage are replayed without a second provider purchase", async () => {
  const h = harness();
  let calls = 0;
  await h.withResearchPaidContext({ researchLogId: "run", stage: "score" }, async () => {
    const invoke = () => h.runResearchPaidOperation({ ...request, execute: async () => {
      calls += 1;
      return { response: "{malformed", usage: { outputTokens: 42 }, settledCostMicrousd: 12 };
    } });
    await assert.rejects(async () => JSON.parse(await invoke()));
    await assert.rejects(async () => JSON.parse(await invoke()));
  });
  assert.equal(calls, 1);
  assert.equal([...h.rows.values()][0].settled_microusd, 12);
  assert.deepEqual([...h.rows.values()][0].usage, { outputTokens: 42 });
});

test("uncertain accepted requests retain full exposure and cannot be blindly bought again", async () => {
  const h = harness({ limit: 60 });
  let calls = 0;
  await h.withResearchPaidContext({ researchLogId: "run", stage: "discovery" }, async () => {
    const invoke = () => h.runResearchPaidOperation({ ...request, execute: async () => { calls += 1; throw new Error("lost response"); } });
    await assert.rejects(invoke, /lost response/);
    await assert.rejects(invoke, /ambiguous/);
    await assert.rejects(() => h.runResearchPaidOperation({ ...request, input: { candidate: "two" }, execute: async () => ({ response: "never" }) }), /budget/);
  });
  assert.equal(calls, 1);
  assert.equal(summarizeResearchPaidOperations([...h.rows.values()]).exposureMicrousd, 40);
});

test("async raw response checkpoint survives parse failure without releasing its reservation", async () => {
  const h = harness();
  await h.withResearchPaidContext({ researchLogId: "run", stage: "discovery" }, async () => {
    await assert.rejects(() => h.runResearchPaidOperation({ ...request, execute: async (handle) => {
      await handle.recordRawResponse({ status: 200, body: "{invalid accepted actor" });
      JSON.parse("{invalid accepted actor");
      return { response: "unreachable" };
    } }));
  });
  const row = [...h.rows.values()][0];
  assert.deepEqual(row.raw_response, { status: 200, body: "{invalid accepted actor" });
  assert.equal(row.status, "ambiguous");
  assert.equal(summarizeResearchPaidOperations([row]).exposureMicrousd, 40);
});

test("saved actor IDs resume polling without launching another actor", async () => {
  const h = harness();
  let starts = 0;
  let polls = 0;
  await h.withResearchPaidContext({ researchLogId: "run", stage: "profiles" }, async () => {
    const input = { ...request, execute: async (handle: { recordRemoteRequest(id: string): Promise<void> }) => {
      starts += 1;
      await handle.recordRemoteRequest("actor-run-1");
      throw new Error("poll interrupted");
    }, resume: async (handle: { remoteRequestId: string | null }) => {
      assert.equal(handle.remoteRequestId, "actor-run-1");
      polls += 1;
      return { response: ["profile"], settledCostMicrousd: 9 };
    } };
    await assert.rejects(() => h.runResearchPaidOperation(input), /poll interrupted/);
    assert.deepEqual(await h.runResearchPaidOperation(input), ["profile"]);
  });
  assert.equal(starts, 1);
  assert.equal(polls, 1);
});

test("simultaneous duplicate operations admit one provider call", async () => {
  const h = harness();
  let calls = 0;
  await h.withResearchPaidContext({ researchLogId: "run", stage: "score" }, async () => {
    const input = { ...request, execute: async () => { calls += 1; return { response: "done", settledCostMicrousd: 4 }; } };
    const results = await Promise.allSettled([h.runResearchPaidOperation(input), h.runResearchPaidOperation(input)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  });
  assert.equal(calls, 1);
});

test("cancellation is checked immediately before work, including resumable polling", async () => {
  const h = harness();
  let calls = 0;
  await h.withResearchPaidContext({ researchLogId: "run", stage: "score" }, async () => {
    h.cancel();
    await assert.rejects(() => h.assertResearchPaidWorkAllowed(), /cancelled/);
    await assert.rejects(() => h.runResearchPaidOperation({ ...request, execute: async () => { calls += 1; return { response: "bad" }; } }), /cancelled/);
  });
  assert.equal(calls, 0);
});

test("missing bounds fail closed only for opted-in research", async () => {
  let calls = 0;
  const invoke = { ...request, maximumCostMicrousd: 0, execute: async () => { calls += 1; return { response: "ok" }; } };
  const enabled = harness();
  await enabled.withResearchPaidContext({ researchLogId: "run", stage: "score" }, async () => {
    await assert.rejects(() => enabled.runResearchPaidOperation(invoke), /positive integer/);
  });
  const legacy = harness({ enabled: false });
  await legacy.withResearchPaidContext({ researchLogId: "legacy", stage: "score" }, async () => {
    assert.equal(legacy.getResearchPaidContext()?.enabled, false);
    assert.equal(await legacy.runResearchPaidOperation(invoke), "ok");
  });
  assert.equal(calls, 1);
});

test("parallel AsyncLocalStorage scopes never share run/stage authority", async () => {
  const h = harness();
  await Promise.all(["first", "second"].map((researchLogId) => h.withResearchPaidContext({ researchLogId, stage: researchLogId }, async () => {
    await Promise.resolve();
    assert.equal(h.getResearchPaidContext()?.researchLogId, researchLogId);
  })));
  assert.equal(h.getResearchPaidContext(), undefined);
});

test("deterministic request identity includes content while ignoring object key order", () => {
  assert.equal(paidOperationInputHash({ a: 1, b: 2 }), paidOperationInputHash({ b: 2, a: 1 }));
  assert.notEqual(paidOperationInputHash({ a: 1 }), paidOperationInputHash({ a: 2 }));
});

test("settled zero is real zero; estimates never release unknown reserved charges", () => {
  assert.deepEqual(summarizeResearchPaidOperations([
    { reserved_microusd: 40, settled_microusd: 0 },
    { reserved_microusd: 40, settled_microusd: null, estimated_microusd: 4 },
    { reserved_microusd: 40, settled_microusd: 10, estimated_microusd: 10 },
  ]), { settledMicrousd: 10, unsettledReservedMicrousd: 40, estimatedMicrousd: 14, exposureMicrousd: 50, operations: 3 });
});

test("only a completed priced-usage upper bound may reduce unsettled exposure", () => {
  assert.deepEqual(summarizeResearchPaidOperations([
    { status: "completed", reserved_microusd: 40, estimated_microusd: 5, usage: { billingBasis: "priced_usage_upper_bound" } },
    { status: "executing", reserved_microusd: 40, estimated_microusd: 5, usage: { billingBasis: "priced_usage_upper_bound" } },
  ]), { settledMicrousd: 0, unsettledReservedMicrousd: 45, estimatedMicrousd: 10, exposureMicrousd: 45, operations: 2 });
});
