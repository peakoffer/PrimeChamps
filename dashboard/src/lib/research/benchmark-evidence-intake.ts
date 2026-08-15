import { HISTORICAL_EVIDENCE_DETAIL_CATEGORIES } from "./historical-social-snapshot.ts";
import type { BenchmarkEvidenceGapRow } from "./benchmark-evidence-gap.ts";

export const BENCHMARK_EVIDENCE_INTAKE_COLUMNS = [
  "record_id",
  "athlete_name",
  "sport",
  "evidence_cutoff_at",
  "needed_gate",
  "claim_category",
  "instagram_handle",
  "tiktok_handle",
  "extracted_value",
  "source_date",
  "source_email_subject",
  "source_document_reference",
  "supporting_excerpt",
  "before_decision_cutoff",
  "identity_match_confidence",
  "notes",
] as const;

export type BenchmarkEvidenceIntakeRow = {
  recordId: string;
  claimCategory: string;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  extractedValue: string;
  sourceDate: string;
  sourceEmailSubject: string;
  sourceDocumentReference: string;
  supportingExcerpt: string;
  beforeDecisionCutoff: "Yes" | "No";
  identityMatchConfidence: "High" | "Medium" | "Low";
  notes: string | null;
};

const CATEGORY_FOR_GATE: Record<string, string> = {
  "exact identity": "Instagram Handle at Decision",
  "21+ eligibility": "Explicit Age or 21+ Evidence",
  "recent athletic momentum": "Athletic Momentum at Decision",
  "audience signal": "Instagram Followers at Decision",
  "creator activity": "Creator Activity at Decision",
};

const NOTE_FOR_GATE: Record<string, string> = {
  "exact identity": "Use only an exact contemporaneous handle tied to this athlete. Public corroboration is still required.",
  "21+ eligibility": "Internal age evidence is stored only as a discovery hint and never clears the two-public-source 21+ gate.",
  "recent athletic momentum": "Quote the dated result, ranking, roster, signing, award, or credible report.",
  "audience signal": "Provide the handle and exact or explicitly approximate pre-cutoff audience metric.",
  "creator activity": "Quote concrete posting cadence, social activity, collaboration, or creator behavior.",
};

function cleanText(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

export function benchmarkEvidenceIntakeContainsOutcomeLeakage(value: string) {
  return [
    /\b(?:final\s+outcome|historical\s+outcome|fit\s+label|pursue\s+today|benchmark\s+score)\b/i,
    /\bapproved\s+but\s+(?:did\s+not|didn't)\s+sign\b/i,
    /\b(?:we|onlyfans|only\s+fans|agency|management)\s+(?:have\s+)?(?:signed|approved|rejected|stalled|declined)\b/i,
    /\b(?:contract|deal|agreement|offer|proposal)\b.{0,50}\b(?:signed|executed|approved|rejected|stalled|declined)\b/i,
    /\b(?:signed|executed|approved|rejected|stalled|declined)\b.{0,50}\b(?:contract|deal|agreement|offer|proposal)\b/i,
    /\b(?:fully\s+executed|countersign(?:ed|ature)|linksquares\s+fully\s+signed|approved\s+structure)\b/i,
  ].some((pattern) => pattern.test(value));
}

export function buildBenchmarkEvidenceIntakeTemplateRows(gaps: BenchmarkEvidenceGapRow[]) {
  return gaps.flatMap((gap) => gap.missingGates.flatMap((gate) => {
    const claimCategory = CATEGORY_FOR_GATE[gate];
    if (!claimCategory) return [];
    return [{
      recordId: gap.recordId,
      athleteName: gap.athleteName,
      sport: gap.sport,
      evidenceCutoffAt: gap.evidenceCutoffAt,
      neededGate: gate,
      claimCategory,
      notes: NOTE_FOR_GATE[gate] || "",
    }];
  }));
}

export function parseBenchmarkEvidenceIntakeRows(value: unknown): BenchmarkEvidenceIntakeRow[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Provide at least one completed evidence row");
  if (value.length > 200) throw new Error("Evidence imports are limited to 200 rows per checkpoint");
  const allowedCategories = new Set<string>(HISTORICAL_EVIDENCE_DETAIL_CATEGORIES);
  const rows = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") throw new Error(`Evidence row ${index + 1} is invalid`);
    const row = candidate as Record<string, unknown>;
    const recordId = cleanText(row.recordId, 100);
    const claimCategory = cleanText(row.claimCategory, 120);
    const extractedValue = cleanText(row.extractedValue, 2_000);
    const sourceDate = cleanText(row.sourceDate, 10);
    const sourceEmailSubject = cleanText(row.sourceEmailSubject, 500);
    const sourceDocumentReference = cleanText(row.sourceDocumentReference, 500);
    const supportingExcerpt = cleanText(row.supportingExcerpt, 4_000);
    const beforeDecisionCutoff = row.beforeDecisionCutoff === "Yes" || row.beforeDecisionCutoff === "No"
      ? row.beforeDecisionCutoff : null;
    const identityMatchConfidence = ["High", "Medium", "Low"].includes(String(row.identityMatchConfidence))
      ? row.identityMatchConfidence as BenchmarkEvidenceIntakeRow["identityMatchConfidence"] : null;
    const missing = [
      !recordId && "record ID",
      !allowedCategories.has(claimCategory) && "supported claim category",
      !extractedValue && "extracted value",
      !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) && "source date",
      !sourceEmailSubject && "exact email subject",
      !sourceDocumentReference && "attachment/document reference",
      !supportingExcerpt && "verbatim supporting excerpt",
      !beforeDecisionCutoff && "before-cutoff confirmation",
      !identityMatchConfidence && "identity-match confidence",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Evidence row ${index + 1} is incomplete: ${missing.join(", ")}`);
    if (benchmarkEvidenceIntakeContainsOutcomeLeakage([
      extractedValue,
      sourceEmailSubject,
      sourceDocumentReference,
      supportingExcerpt,
      cleanText(row.notes, 1_000),
    ].join("\n"))) {
      throw new Error(`Evidence row ${index + 1} contains a benchmark outcome, fit judgment, or deal-decision phrase`);
    }
    return {
      recordId,
      claimCategory,
      instagramHandle: cleanText(row.instagramHandle, 100) || null,
      tiktokHandle: cleanText(row.tiktokHandle, 100) || null,
      extractedValue,
      sourceDate,
      sourceEmailSubject,
      sourceDocumentReference,
      supportingExcerpt,
      beforeDecisionCutoff: beforeDecisionCutoff! as BenchmarkEvidenceIntakeRow["beforeDecisionCutoff"],
      identityMatchConfidence: identityMatchConfidence! as BenchmarkEvidenceIntakeRow["identityMatchConfidence"],
      notes: cleanText(row.notes, 1_000) || null,
    };
  });
  const keys = rows.map((row) => [
    row.recordId,
    row.claimCategory,
    row.sourceDate,
    row.sourceEmailSubject.toLowerCase(),
    row.sourceDocumentReference.toLowerCase(),
    row.supportingExcerpt.toLowerCase(),
  ].join("|"));
  if (new Set(keys).size !== keys.length) throw new Error("The evidence import contains duplicate completed rows");
  return rows;
}

function normalizedIdentity(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function evidenceExcerptIdentifiesAthlete(input: {
  athleteName: string;
  excerpt: string;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
}) {
  const excerpt = normalizedIdentity(input.excerpt);
  const athlete = normalizedIdentity(input.athleteName);
  if (athlete && excerpt.includes(athlete)) return true;
  return [input.instagramHandle, input.tiktokHandle].some((handle) => {
    const normalized = normalizedIdentity(String(handle || "").replace(/^@/, ""));
    return normalized.length >= 3 && excerpt.includes(normalized);
  });
}
