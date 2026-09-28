import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("manual research promotion refuses evaluation runs before any athlete write", () => {
  const route = read("src/app/api/research/sessions/[id]/athletes/route.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  const refusal = post.indexOf("log.is_evaluation === true");
  assert.ok(refusal > 0, "POST must check the stored run's evaluation flag");
  assert.ok(refusal < post.indexOf('.from("athletes")'), "the evaluation refusal must precede every athlete read or write");
  assert.match(post.slice(refusal, refusal + 300), /status: 403/);
  const get = route.slice(0, route.indexOf("export async function POST"));
  assert.match(get, /can_move: Boolean\(\s*log\.is_evaluation !== true &&/, "evaluation candidates must never be draggable to Approval");
});

test("research approval trusts only the stored candidate and refuses evaluation data", () => {
  const route = read("src/app/api/research/approve/route.ts");
  const insert = route.indexOf('.from("athletes")\n      .insert');
  const gates = route.slice(0, insert);
  assert.match(gates, /select\("id,research_log_id,is_test_data,is_minor,age_verified,score,instagram_handle"\)/);
  assert.match(gates, /run\.is_evaluation === true \|\| stored\.is_test_data === true/);
  assert.match(gates, /stored\.age_verified !== true/);
  assert.match(gates, /stored\.is_minor === true/);
  assert.doesNotMatch(gates, /candidate\.age_verified|candidate\.is_minor|candidate\.score/,
    "client-supplied gate values must not decide approval");
  assert.match(route, /source_research_log_id: stored\.research_log_id/);
});

test("the pipeline board lists only live research runs", () => {
  assert.match(read("src/app/pipeline/page.tsx"), /\/api\/research\/sessions\?limit=10&live=1/);
  assert.match(read("src/app/api/research/sessions/route.ts"), /if \(liveOnly\) query = query\.eq\("is_evaluation", false\)/);
});

test("the database rejects evaluation-sourced athletes and evaluation relabelling", () => {
  const first = read("../supabase/migrations/20260928213000_research_evaluation_crm_isolation.sql");
  const split = read("../supabase/migrations/20260928214500_research_evaluation_flag_guards_split.sql");
  assert.match(first, /before insert or update of source_research_log_id on public\.athletes/);
  assert.match(first, /l\.is_evaluation = true/);
  assert.match(split, /before update of is_evaluation on public\.research_logs/);
  assert.match(split, /before update of is_test_data on public\.research_candidates/);
  // One shared trigger function cannot read table-specific fields in PL/pgSQL.
  assert.doesNotMatch(split, /create or replace function public\.keep_research_evaluation_flags\(\)/);
  assert.match(split, /drop function if exists public\.keep_research_evaluation_flags\(\)/);
});
