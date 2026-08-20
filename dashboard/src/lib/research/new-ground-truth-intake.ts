import { benchmarkEvidenceIntakeContainsOutcomeLeakage } from "./benchmark-evidence-intake.ts";
import type { HistoricalEvidenceDetailInput } from "./historical-social-snapshot.ts";

export const ONLYFANS_NEW_GROUND_TRUTH_DATASET = "onlyfans_new_ground_truth_2026_08_20";

export type NewGroundTruthWorkbookExtraction = {
  sourceWorkbook?: string;
  outcomeCases: unknown[][];
  evidenceRows: unknown[][];
};

export type NewGroundTruthOutcomeCase = {
  caseId: string;
  athleteName: string;
  sport: string;
  outcome: "Signed" | "Approved but Did Not Sign";
  decisionDate: string;
  evidenceCutoff: string;
  outcomeConfirmationDate: string;
  outcomeReference: string;
  notes: string | null;
  expectedEvidenceRows: number;
  expectedIdentitySources: number;
  expectedAdultSources: number;
  expectedMomentumSources: number;
  expectedAudienceSources: number;
  expectedCreatorSources: number;
  expectedPacketStatus: "READY" | "INCOMPLETE";
};

export type NewGroundTruthEvidenceRow = {
  caseId: string;
  athleteName: string;
  sourceCategory: "Identity" | "21+" | "Momentum" | "Audience" | "Creator Behavior";
  sourceDate: string;
  sourceReference: string;
  publisher: string;
  supportingExcerpt: string;
  notes: string | null;
  detail: HistoricalEvidenceDetailInput;
};

export type ConvertedNewGroundTruthIntake = {
  sourceWorkbook: string;
  cases: Array<NewGroundTruthOutcomeCase & { evidence: NewGroundTruthEvidenceRow[] }>;
  validation: {
    cases: number;
    positiveCases: number;
    evidenceRows: number;
    evidenceCompletePackets: number;
    missingAdultEvidenceCases: string[];
    missingAudienceEvidenceCases: string[];
  };
};

function cleanText(value: unknown, maximum = 4_000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function countValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid evidence count: ${String(value)}`);
  return parsed;
}

function excelDate(value: unknown, label: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be an Excel or ISO date`);
  const timestamp = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`);
  return date.toISOString().slice(0, 10);
}

function headerIndex(rows: unknown[][], firstColumn: string) {
  const index = rows.findIndex((row) => cleanText(row?.[0]) === firstColumn);
  if (index < 0) throw new Error(`Workbook is missing the ${firstColumn} header row`);
  return index;
}

function instagramHandle(value: string) {
  return value.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})(?:[/?#\s]|$)/i)?.[1] || null;
}

function tiktokHandle(value: string) {
  return value.match(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})(?:[/?#\s]|$)/i)?.[1] || null;
}

function emailSubject(value: string) {
  return value.match(/\bEmail\s+["“]([^"”]+)["”]/i)?.[1]?.trim()
    || value.match(/\bemail\s+subject\s*[:=-]\s*["“]?([^"”;]+)["”]?/i)?.[1]?.trim()
    || value.slice(0, 500);
}

function normalizedName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function evidenceDetail(input: {
  category: NewGroundTruthEvidenceRow["sourceCategory"];
  athleteName: string;
  sourceDate: string;
  sourceReference: string;
  supportingExcerpt: string;
  notes: string | null;
}) {
  const combined = `${input.sourceReference}\n${input.supportingExcerpt}`;
  const instagram = instagramHandle(combined);
  const tiktok = tiktokHandle(combined);
  const category = input.category === "Identity"
    ? instagram ? "Instagram Handle at Decision"
      : tiktok ? "TikTok Handle at Decision"
        : "Exact Athlete Identity"
    : input.category === "21+" ? "Explicit Age or 21+ Evidence"
      : input.category === "Momentum" ? "Athletic Momentum at Decision"
        : input.category === "Creator Behavior" ? "Creator Activity at Decision"
          : /\bfollowers?\b/i.test(input.supportingExcerpt)
            ? "Instagram Followers at Decision"
            : "Audience Reach or Views at Decision";
  const extractedValue = instagram || tiktok || input.supportingExcerpt;
  return {
    claimCategory: category,
    extractedValue,
    sourceDate: input.sourceDate,
    sourceEmailSubject: emailSubject(input.sourceReference),
    sourceDocumentReference: input.sourceReference,
    supportingExcerpt: input.supportingExcerpt,
    beforeDecisionCutoff: "Yes",
    identityMatchConfidence: "High",
    notes: input.notes,
  } satisfies HistoricalEvidenceDetailInput;
}

export function convertNewGroundTruthWorkbookExtraction(
  extraction: NewGroundTruthWorkbookExtraction
): ConvertedNewGroundTruthIntake {
  if (!extraction || !Array.isArray(extraction.outcomeCases) || !Array.isArray(extraction.evidenceRows)) {
    throw new Error("New ground-truth workbook extraction is invalid");
  }
  const outcomeHeader = headerIndex(extraction.outcomeCases, "Case ID");
  const cases = extraction.outcomeCases.slice(outcomeHeader + 1).flatMap((row): NewGroundTruthOutcomeCase[] => {
    const caseId = cleanText(row?.[0], 40).toUpperCase();
    if (!caseId) return [];
    if (!/^NEW-\d{2,3}$/.test(caseId)) throw new Error(`Invalid case ID: ${caseId}`);
    const athleteName = cleanText(row?.[1], 160);
    const sport = cleanText(row?.[2], 100);
    const outcome = cleanText(row?.[3], 80);
    if (!athleteName || !sport) throw new Error(`${caseId} is missing athlete name or sport`);
    if (outcome !== "Signed" && outcome !== "Approved but Did Not Sign") {
      throw new Error(`${caseId} is not a positive Dylan-confirmed outcome`);
    }
    const decisionDate = excelDate(row?.[4], `${caseId} decision date`);
    const evidenceCutoff = excelDate(row?.[5], `${caseId} evidence cutoff`);
    const outcomeConfirmationDate = excelDate(row?.[6], `${caseId} outcome confirmation date`);
    if (evidenceCutoff > decisionDate) throw new Error(`${caseId} evidence cutoff is after its decision date`);
    if (cleanText(row?.[8]).toLowerCase() !== "yes") throw new Error(`${caseId} is not Dylan-confirmed`);
    if (cleanText(row?.[9]).toLowerCase() !== "no") throw new Error(`${caseId} is marked as already present in the original 100`);
    const outcomeReference = cleanText(row?.[7], 2_000);
    if (!outcomeReference) throw new Error(`${caseId} is missing its private outcome reference`);
    const packetStatus = cleanText(row?.[17]).toUpperCase();
    if (packetStatus !== "READY" && packetStatus !== "INCOMPLETE") throw new Error(`${caseId} has an invalid packet status`);
    return [{
      caseId,
      athleteName,
      sport,
      outcome,
      decisionDate,
      evidenceCutoff,
      outcomeConfirmationDate,
      outcomeReference,
      notes: cleanText(row?.[10], 1_000) || null,
      expectedEvidenceRows: countValue(row?.[11]),
      expectedIdentitySources: countValue(row?.[12]),
      expectedAdultSources: countValue(row?.[13]),
      expectedMomentumSources: countValue(row?.[14]),
      expectedAudienceSources: countValue(row?.[15]),
      expectedCreatorSources: countValue(row?.[16]),
      expectedPacketStatus: packetStatus,
    }];
  });
  if (!cases.length) throw new Error("Workbook contains no completed outcome cases");
  const caseIds = cases.map((item) => item.caseId);
  if (new Set(caseIds).size !== caseIds.length) throw new Error("Workbook contains duplicate case IDs");
  const names = cases.map((item) => normalizedName(item.athleteName));
  if (new Set(names).size !== names.length) throw new Error("Workbook contains duplicate athlete names");
  const caseById = new Map(cases.map((item) => [item.caseId, item]));

  const evidenceHeader = headerIndex(extraction.evidenceRows, "Case ID");
  const evidence = extraction.evidenceRows.slice(evidenceHeader + 1).flatMap((row): NewGroundTruthEvidenceRow[] => {
    const caseId = cleanText(row?.[0], 40).toUpperCase();
    if (!caseId) return [];
    const outcomeCase = caseById.get(caseId);
    if (!outcomeCase) throw new Error(`Evidence references unknown case ${caseId}`);
    const athleteName = cleanText(row?.[1], 160);
    if (normalizedName(athleteName) !== normalizedName(outcomeCase.athleteName)) {
      throw new Error(`${caseId} evidence athlete does not match its outcome case`);
    }
    const category = cleanText(row?.[2], 80) as NewGroundTruthEvidenceRow["sourceCategory"];
    if (!["Identity", "21+", "Momentum", "Audience", "Creator Behavior"].includes(category)) {
      throw new Error(`${caseId} has unsupported evidence category ${category || "missing"}`);
    }
    const sourceDate = excelDate(row?.[3], `${caseId} evidence source date`);
    if (sourceDate > outcomeCase.evidenceCutoff) throw new Error(`${caseId} contains post-cutoff evidence`);
    const sourceReference = cleanText(row?.[4], 2_000);
    const publisher = cleanText(row?.[5], 500);
    const supportingExcerpt = cleanText(row?.[6], 4_000);
    if (!sourceReference || !publisher || !supportingExcerpt) throw new Error(`${caseId} has incomplete evidence provenance`);
    if (cleanText(row?.[7]).toLowerCase() !== "yes") throw new Error(`${caseId} has evidence not confirmed before cutoff`);
    if (cleanText(row?.[8]).toLowerCase() !== "yes") throw new Error(`${caseId} has evidence without an exact athlete/handle match`);
    if (cleanText(row?.[10]).toUpperCase() !== "VALID") throw new Error(`${caseId} has a non-valid populated evidence row`);
    const notes = cleanText(row?.[9], 1_000) || null;
    if (benchmarkEvidenceIntakeContainsOutcomeLeakage([
      sourceReference, publisher, supportingExcerpt, notes || "",
    ].join("\n"))) throw new Error(`${caseId} evidence contains outcome leakage`);
    return [{
      caseId,
      athleteName,
      sourceCategory: category,
      sourceDate,
      sourceReference,
      publisher,
      supportingExcerpt,
      notes,
      detail: evidenceDetail({ category, athleteName, sourceDate, sourceReference, supportingExcerpt, notes }),
    }];
  });
  const evidenceKeys = evidence.map((row) => [row.caseId, row.sourceCategory, row.sourceDate, row.sourceReference, row.supportingExcerpt].join("|").toLowerCase());
  if (new Set(evidenceKeys).size !== evidenceKeys.length) throw new Error("Workbook contains duplicate evidence rows");

  const completedCases = cases.map((item) => {
    const rows = evidence.filter((row) => row.caseId === item.caseId);
    const counts = {
      evidence: rows.length,
      identity: rows.filter((row) => row.sourceCategory === "Identity").length,
      adult: rows.filter((row) => row.sourceCategory === "21+").length,
      momentum: rows.filter((row) => row.sourceCategory === "Momentum").length,
      audience: rows.filter((row) => row.sourceCategory === "Audience").length,
      creator: rows.filter((row) => row.sourceCategory === "Creator Behavior").length,
    };
    const expected = [
      ["evidence", counts.evidence, item.expectedEvidenceRows],
      ["identity", counts.identity, item.expectedIdentitySources],
      ["21+", counts.adult, item.expectedAdultSources],
      ["momentum", counts.momentum, item.expectedMomentumSources],
      ["audience", counts.audience, item.expectedAudienceSources],
      ["creator", counts.creator, item.expectedCreatorSources],
    ] as const;
    const mismatch = expected.find(([, actual, stated]) => actual !== stated);
    if (mismatch) throw new Error(`${item.caseId} ${mismatch[0]} count is ${mismatch[1]}, workbook states ${mismatch[2]}`);
    const ready = counts.identity >= 2 && counts.adult >= 2 && counts.momentum >= 1
      && counts.audience >= 1 && counts.creator >= 1;
    if ((ready ? "READY" : "INCOMPLETE") !== item.expectedPacketStatus) {
      throw new Error(`${item.caseId} packet status does not match its evidence counts`);
    }
    return { ...item, evidence: rows };
  });

  return {
    sourceWorkbook: cleanText(extraction.sourceWorkbook, 200) || "unknown.xlsx",
    cases: completedCases,
    validation: {
      cases: completedCases.length,
      positiveCases: completedCases.length,
      evidenceRows: evidence.length,
      evidenceCompletePackets: completedCases.filter((item) => item.expectedPacketStatus === "READY").length,
      missingAdultEvidenceCases: completedCases.filter((item) => item.expectedAdultSources < 2).map((item) => item.athleteName),
      missingAudienceEvidenceCases: completedCases.filter((item) => item.expectedAudienceSources < 1).map((item) => item.athleteName),
    },
  };
}
