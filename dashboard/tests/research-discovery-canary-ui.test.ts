import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("discovery diagnostic is separate from quality certification and never starts on mount or refresh", () => {
  const source = readFileSync(new URL("../src/app/pipeline/research/hardening/discovery-canary-panel.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let paidFetches = 0;
  const paidHandlers = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "fetch" && /method: "POST"/.test(node.getText(parsed))) {
      paidFetches++;
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
      const name = parent && ts.isFunctionDeclaration(parent) ? parent.name?.text : null;
      assert.ok(name === "start" || name === "startSearchAccessCheck");
      paidHandlers.add(name);
    }
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
      assert.doesNotMatch(node.getText(parsed), /\b(?:start|startSearchAccessCheck)\s*\(/, "Effects may refresh receipts, never buy a diagnostic");
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(paidFetches, 2);
  assert.deepEqual([...paidHandlers].sort(), ["start", "startSearchAccessCheck"]);
  assert.match(source, /!isOwner \|\| !view\?\.eligible \|\| view.canary \|\| submitLock.current/);
  assert.match(source, /!isOwner \|\| !searchAccess\?\.eligible \|\| searchAccess.check \|\| searchAccessLock.current/);
  assert.match(source, /disabled=\{!view\?\.eligible \|\| starting \|\| submitted\}/);
  assert.match(source, /does not certify candidate quality/);
  assert.match(source, /not a reconciled provider invoice/);
});

test("server page supplies owner status and each campaign has isolated diagnostic state", () => {
  const page = readFileSync(new URL("../src/app/pipeline/research/hardening/page.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/app/pipeline/research/hardening/hardening-client.tsx", import.meta.url), "utf8");
  assert.match(page, /isOwner=\{user.role === "owner"\}/);
  assert.match(client, /DiscoveryCanaryPanel key=\{campaign.id\} campaignId=\{campaign.id\} isOwner=\{isOwner\}/);
});
