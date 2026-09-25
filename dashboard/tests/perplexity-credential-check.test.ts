import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { checkPerplexityCredential } from "../src/lib/perplexity-credential-check.ts";

const syntheticKey = "pplx-synthetic-test-value-never-a-real-secret";
const modelsUrl = "https://api.perplexity.ai/router/v1/models";
type Result = Awaited<ReturnType<typeof checkPerplexityCredential>>;

function assertSafeResult(result: Result) {
  assert.equal(result.searchAccessVerified, false);
  assert.equal(result.researchReady, false);
  assert.equal(typeof result.message, "string");
  assert.ok(result.message.length > 0);
  assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  assert.equal(JSON.stringify(result).includes("provider-secret-body"), false);
}

function responseFetcher(response: Response) {
  const calls: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return response;
  };
  return { calls, fetcher };
}

test("missing and malformed credentials make no external request and never normalize bad keys", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; throw new Error("Unexpected credential request"); };
  for (const value of [undefined, ""]) {
    const result = await checkPerplexityCredential(value, fetcher);
    assert.equal(result.credentialStatus, "missing");
    assert.equal(result.providerHttpStatus, null);
    assertSafeResult(result);
  }
  for (const value of [" ", "invalid-prefix", `Bearer ${syntheticKey}`, ` ${syntheticKey}`,
    `${syntheticKey}\n`, `${syntheticKey} `, `"${syntheticKey}"`, `'${syntheticKey}'`, "pplx-internal space", "pplx-tab\tvalue"]) {
    const result = await checkPerplexityCredential(value, fetcher);
    assert.equal(result.credentialStatus, "malformed", `Unexpected classification for synthetic input ${JSON.stringify(value)}`);
    assert.equal(result.providerHttpStatus, null);
    assertSafeResult(result);
  }
  assert.equal(calls, 0);
});

test("valid model-list responses use exactly one fixed no-store GET with no paid query", async (t) => {
  const timeoutMs: number[] = [];
  const signal = new AbortController().signal;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { timeoutMs.push(milliseconds); return signal; });
  for (const payload of [{ object: "list", data: [] }, { object: "list", data: [{ id: "synthetic-model-id" }] }]) {
    const { calls, fetcher } = responseFetcher(Response.json(payload));
    const result = await checkPerplexityCredential(syntheticKey, fetcher);
    assert.equal(result.credentialStatus, "accepted");
    assert.equal(result.providerHttpStatus, 200);
    assertSafeResult(result);
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].input), modelsUrl);
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.cache, "no-store");
    assert.equal(calls[0].init?.redirect, "error");
    assert.equal(calls[0].init?.signal, signal);
    assert.equal(calls[0].init?.body, undefined);
    assert.equal(new Headers(calls[0].init?.headers).get("Authorization"), `Bearer ${syntheticKey}`);
  }
  assert.deepEqual(timeoutMs, [8_000, 8_000]);
});

test("401 and 403 reject credentials without exposing provider errors or retrying", async () => {
  for (const status of [401, 403]) {
    const { calls, fetcher } = responseFetcher(Response.json({ error: { message: `${syntheticKey} provider-secret-body` } }, { status }));
    const result = await checkPerplexityCredential(syntheticKey, fetcher);
    assert.equal(result.credentialStatus, "rejected");
    assert.equal(result.providerHttpStatus, status);
    assertSafeResult(result);
    assert.equal(calls.length, 1);
  }
});

test("rate limits, provider outages and redirects are unavailable, not proof of bad credentials", async () => {
  for (const status of [302, 404, 429, 500, 503]) {
    const { calls, fetcher } = responseFetcher(new Response(`${syntheticKey} provider-secret-body`, {
      status, headers: status === 302 ? { Location: "https://example.invalid/credential-trap" } : {},
    }));
    const result = await checkPerplexityCredential(syntheticKey, fetcher);
    assert.equal(result.credentialStatus, "unavailable");
    assert.equal(result.providerHttpStatus, status);
    assertSafeResult(result);
    assert.equal(calls.length, 1);
  }
});

test("a successful HTTP response without the model-list data array is not accepted", async () => {
  for (const response of [Response.json(null), Response.json({}), Response.json([]), Response.json({ data: [] }),
    Response.json({ object: "wrong", data: [] }), Response.json({ object: "list", data: {} }),
    ...[null, {}, { id: 42 }, { id: "" }].map((model) => Response.json({ object: "list", data: [model] })),
    Response.json({ object: "list", data: "provider-secret-body" }), new Response("<html>provider-secret-body</html>", { status: 200 }),
    new Response('{"data":', { status: 200 })]) {
    const { calls, fetcher } = responseFetcher(response);
    const result = await checkPerplexityCredential(syntheticKey, fetcher);
    assert.equal(result.credentialStatus, "unavailable");
    assert.equal(result.providerHttpStatus, 200);
    assertSafeResult(result);
    assert.equal(calls.length, 1);
  }
});

test("transport and redirect errors are redacted and never retried", async () => {
  for (const error of [new TypeError(`fetch failed ${syntheticKey} provider-secret-body`),
    new TypeError(`redirect is not allowed ${syntheticKey}`)]) {
    let calls = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      calls += 1; assert.equal(init?.redirect, "error"); throw error;
    };
    const result = await checkPerplexityCredential(syntheticKey, fetcher);
    assert.equal(result.credentialStatus, "unavailable");
    assert.equal(result.providerHttpStatus, null);
    assertSafeResult(result);
    assert.equal(calls, 1);
  }
});

test("the eight-second timeout is enforced without reporting acceptance or leaking exception text", async (t) => {
  const signal = AbortSignal.abort(new DOMException(`${syntheticKey} provider-secret-body`, "TimeoutError"));
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { assert.equal(milliseconds, 8_000); return signal; });
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    assert.equal(init?.signal, signal);
    assert.equal(init?.signal?.aborted, true);
    throw init?.signal?.reason;
  };
  const result = await checkPerplexityCredential(syntheticKey, fetcher);
  assert.equal(result.credentialStatus, "unavailable");
  assert.equal(result.providerHttpStatus, null);
  assertSafeResult(result);
  assert.equal(calls, 1);
});

test("production route is owner-only before checking the server key, non-cacheable and read-only", async () => {
  const source = await readFile(new URL("../src/app/api/providers/perplexity/health/route.ts", import.meta.url), "utf8");
  const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handler = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "GET");
  assert.ok(handler?.body, "A GET handler is required");
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); }
  visit(handler.body);
  const authorize = calls.find((node) => node.expression.getText(file) === "requireOrganizationRole");
  const check = calls.find((node) => node.expression.getText(file) === "checkPerplexityCredential");
  assert.ok(authorize && check);
  assert.ok(authorize.getStart(file) < check.getStart(file), "Owner authorization must precede the credential check");
  assert.match(authorize.getText(file), /\[\s*["']owner["']\s*\]/);
  assert.equal(ts.isAwaitExpression(authorize.parent), true);
  assert.match(check.getText(file), /process\.env\.PERPLEXITY_API_KEY/);
  assert.match(source, /["']Cache-Control["']\s*:\s*["']private, no-store["']/);
  for (const response of calls.filter((node) => node.expression.getText(file) === "NextResponse.json")) {
    assert.ok(response.arguments[1], "All responses need explicit cache control");
    assert.match(response.arguments[1].getText(file), /\bheaders\b/);
  }
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(source, /researchPaidFetch|runResearchPaidOperation|launchDiscoveryProbe|createAdminClient|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
  assert.doesNotMatch(source, /request\.(?:json|text)\(|searchParams|console\.(?:log|error|warn)/);
});

test("saved-key UI requires an owner click and keeps credential status separate from paid diagnostic receipts", async () => {
  const source = await readFile(new URL("../src/app/pipeline/research/hardening/discovery-canary-panel.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.FunctionDeclaration | undefined;
  let explicitClicks = 0;
  let credentialFetches = 0;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "checkCredential") handler = node;
    if (ts.isCallExpression(node) && node.expression.getText(file) === "checkCredential") {
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isJsxAttribute(parent)) parent = parent.parent;
      assert.ok(parent && ts.isJsxAttribute(parent));
      assert.equal(parent.name.getText(file), "onClick", "Credential checks must only start from an explicit click");
      explicitClicks += 1;
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === "fetch"
      && node.arguments[0]?.getText(file).includes("/api/providers/perplexity/health")) {
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
      assert.equal(parent && ts.isFunctionDeclaration(parent) ? parent.name?.text : null, "checkCredential");
      credentialFetches += 1;
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect") {
      assert.doesNotMatch(node.getText(file), /checkCredential|perplexity\/health/);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(explicitClicks, 1);
  assert.equal(credentialFetches, 1);
  assert.ok(handler?.body);
  const body = handler.body.getText(file);
  assert.match(body, /if\s*\(\s*!isOwner\s*\|\|\s*credentialLock\.current\s*\)\s*return/);
  assert.ok(body.indexOf("!isOwner") < body.indexOf("fetch("));
  assert.match(body, /cache:\s*["']no-store["']/);
  assert.match(body, /setCredentialCheck\(/);
  assert.doesNotMatch(body, /setView\(|\bstart\(|\bload\(|method:\s*["']POST["']|discovery-canary|researchPaid|launchDiscovery/);
  assert.match(source, /\{isOwner\s*&&\s*<button[^>]*onClick=\{\(\)\s*=>\s*void checkCredential\(\)\}[^>]*disabled=\{checkingCredential\}/);
  assert.match(source, /\{credentialCheck\s*&&\s*<div\s+role="status"/);
  assert.match(source, /\{credentialCheck\.message\}/);
  assert.match(source, /Previous research receipts below remain unchanged/);
  assert.match(source, /\{view\?\.canary\s*&&/);
});
