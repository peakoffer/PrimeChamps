import type {
  HistoricalBenchmarkRecord,
} from "./historical-benchmark.ts";
import type {
  HistoricalEvidenceDetailInput,
} from "./historical-social-snapshot.ts";

type CellValue = string | number | boolean | null;
type SheetMatrix = CellValue[][];

export type HistoricalWorkbookExtraction = {
  workbook?: string;
  extractedAt?: string;
  sheets: Record<string, SheetMatrix | undefined>;
};

export type HistoricalWorkbookConversion = {
  records: HistoricalBenchmarkRecord[];
  validation: {
    records: number;
    lockedDifferences: number;
    outcomeCounts: Record<string, number>;
    evidenceDetailRows: number;
    evidenceDetailAthletes: number;
    evidenceDetailCategoryCounts: Record<string, number>;
    highConfidenceDetails: number;
    mediumConfidenceDetails: number;
    lowConfidenceDetails: number;
  };
};

const LOCKED_BENCHMARK_HEADERS = [
  "Athlete / Talent",
  "Approx. decision date",
  "OnlyFans fit at the time",
  "Outcome",
  "Primary reason",
  "One-sentence explanation",
  "Evidence ref",
  "Confidence",
] as const;

const EVIDENCE_INDEX_HEADERS = [
  "Evidence ref",
  "Athlete / Talent",
  "Email subject(s)",
  "Relevant date(s)",
  "What the evidence establishes",
  "Notes / documents available",
] as const;

const DETAIL_HEADERS = [
  "Athlete Name",
  "Claim Category",
  "Extracted Value",
  "Source Date",
  "Email Subject",
  "Attachment Filename or Document Reference",
  "Supporting Excerpt",
  "Before Decision Cutoff — Yes/No",
  "Identity Match Confidence — High/Medium/Low",
  "Notes",
] as const;

const NON_CLAIM_DETAIL_CATEGORIES = new Set([
  "Evidence Source Date",
  "Evidence Email Subject",
  "Evidence Attachment or Document Reference",
  "Evidence Availability Notes",
]);

const MISSING_VALUES = new Set(["", "-", "—", "n/a", "na", "none", "not available", "unknown"]);

function clean(value: CellValue | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function isMissing(value: CellValue | undefined) {
  return MISSING_VALUES.has(clean(value).toLowerCase());
}

function excelDate(value: CellValue | undefined, label: string) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T12:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text) return text;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000;
    const date = new Date(timestamp);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  throw new Error(`${label} is not a valid Excel or YYYY-MM-DD date: ${text || "missing"}`);
}

function requireSheet(extraction: HistoricalWorkbookExtraction, name: string) {
  const sheet = extraction.sheets[name];
  if (!sheet) throw new Error(`Workbook extraction is missing required sheet: ${name}`);
  return sheet;
}

function headerIndex(row: SheetMatrix[number], expected: string, sheet: string) {
  const index = row.findIndex((value) => clean(value) === expected);
  if (index < 0) throw new Error(`${sheet} is missing required column: ${expected}`);
  return index;
}

function tableRows(sheet: SheetMatrix, requiredHeaders: readonly string[], sheetName: string) {
  const headerRowIndex = sheet.findIndex((row) => requiredHeaders.every((header) =>
    row.some((value) => clean(value) === header)));
  if (headerRowIndex < 0) throw new Error(`${sheetName} does not contain the expected header row`);
  const header = sheet[headerRowIndex];
  const columns = Object.fromEntries(requiredHeaders.map((name) => [name, headerIndex(header, name, sheetName)]));
  return {
    header,
    columns: columns as Record<string, number>,
    rows: sheet.slice(headerRowIndex + 1).filter((row) => row.some((value) => clean(value))),
  };
}

function lockedCell(value: CellValue | undefined, column: number) {
  return column === 1 ? excelDate(value, "Locked decision date") : clean(value);
}

function compareLockedSource(input: {
  enrichedBenchmark: SheetMatrix;
  enrichedEvidence: SheetMatrix;
  baseline: HistoricalWorkbookExtraction;
}) {
  const baselineBenchmark = tableRows(requireSheet(input.baseline, "Benchmark"), LOCKED_BENCHMARK_HEADERS, "Baseline Benchmark");
  const enrichedBenchmark = tableRows(input.enrichedBenchmark, LOCKED_BENCHMARK_HEADERS, "Enriched Benchmark");
  const baselineEvidence = tableRows(requireSheet(input.baseline, "Evidence Index"), EVIDENCE_INDEX_HEADERS, "Baseline Evidence Index");
  const enrichedEvidence = tableRows(input.enrichedEvidence, EVIDENCE_INDEX_HEADERS, "Enriched Evidence Index");
  if (baselineBenchmark.rows.length !== 100 || enrichedBenchmark.rows.length !== 100) {
    throw new Error(`Locked benchmark must contain 100 rows (baseline ${baselineBenchmark.rows.length}, enriched ${enrichedBenchmark.rows.length})`);
  }
  if (baselineEvidence.rows.length !== 100 || enrichedEvidence.rows.length !== 100) {
    throw new Error(`Locked evidence index must contain 100 rows (baseline ${baselineEvidence.rows.length}, enriched ${enrichedEvidence.rows.length})`);
  }
  const differences: string[] = [];
  for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) {
    for (let column = 0; column < LOCKED_BENCHMARK_HEADERS.length; column += 1) {
      const header = LOCKED_BENCHMARK_HEADERS[column];
      const left = lockedCell(baselineBenchmark.rows[rowIndex][baselineBenchmark.columns[header]], column);
      const right = lockedCell(enrichedBenchmark.rows[rowIndex][enrichedBenchmark.columns[header]], column);
      if (left !== right) differences.push(`Benchmark row ${rowIndex + 1} ${header}: ${left} != ${right}`);
    }
    for (const header of EVIDENCE_INDEX_HEADERS) {
      const left = clean(baselineEvidence.rows[rowIndex][baselineEvidence.columns[header]]);
      const right = clean(enrichedEvidence.rows[rowIndex][enrichedEvidence.columns[header]]);
      if (left !== right) differences.push(`Evidence Index row ${rowIndex + 1} ${header}: ${left} != ${right}`);
    }
  }
  if (differences.length) {
    throw new Error(`Enriched workbook changed ${differences.length} locked source cell(s): ${differences.slice(0, 5).join("; ")}`);
  }
  return differences.length;
}

function detailRecord(row: SheetMatrix[number], columns: Record<string, number>): HistoricalEvidenceDetailInput | null {
  const claimCategory = clean(row[columns["Claim Category"]]);
  if (NON_CLAIM_DETAIL_CATEGORIES.has(claimCategory)) return null;
  const extractedValue = clean(row[columns["Extracted Value"]]);
  if (isMissing(extractedValue)) return null;
  return {
    claimCategory,
    extractedValue,
    sourceDate: excelDate(row[columns["Source Date"]], `Evidence detail ${claimCategory} source date`),
    sourceEmailSubject: clean(row[columns["Email Subject"]]),
    sourceDocumentReference: clean(row[columns["Attachment Filename or Document Reference"]]),
    supportingExcerpt: clean(row[columns["Supporting Excerpt"]]),
    beforeDecisionCutoff: clean(row[columns["Before Decision Cutoff — Yes/No"]]) as "Yes" | "No",
    identityMatchConfidence: clean(row[columns["Identity Match Confidence — High/Medium/Low"]]) as "High" | "Medium" | "Low",
    notes: clean(row[columns["Notes"]]) || null,
  };
}

export function convertOnlyFansHistoricalWorkbookExtraction(input: {
  enriched: HistoricalWorkbookExtraction;
  baseline?: HistoricalWorkbookExtraction | null;
}): HistoricalWorkbookConversion {
  const benchmarkSheet = requireSheet(input.enriched, "Benchmark");
  const evidenceSheet = requireSheet(input.enriched, "Evidence Index");
  const detailSheet = requireSheet(input.enriched, "Historical Evidence Details");
  const lockedDifferences = input.baseline ? compareLockedSource({
    enrichedBenchmark: benchmarkSheet,
    enrichedEvidence: evidenceSheet,
    baseline: input.baseline,
  }) : 0;
  const benchmark = tableRows(benchmarkSheet, LOCKED_BENCHMARK_HEADERS, "Benchmark");
  const evidence = tableRows(evidenceSheet, EVIDENCE_INDEX_HEADERS, "Evidence Index");
  const details = tableRows(detailSheet, DETAIL_HEADERS, "Historical Evidence Details");
  if (benchmark.rows.length !== 100 || evidence.rows.length !== 100) {
    throw new Error(`Expected exactly 100 benchmark and evidence rows, received ${benchmark.rows.length} and ${evidence.rows.length}`);
  }

  const evidenceByRef = new Map(evidence.rows.map((row) => [clean(row[evidence.columns["Evidence ref"]]), row]));
  const detailRowsByAthlete = new Map<string, HistoricalEvidenceDetailInput[]>();
  for (const row of details.rows) {
    const athleteName = clean(row[details.columns["Athlete Name"]]);
    const detail = detailRecord(row, details.columns);
    if (!detail) continue;
    detailRowsByAthlete.set(athleteName, [...(detailRowsByAthlete.get(athleteName) || []), detail]);
  }

  const names = new Set<string>();
  const refs = new Set<string>();
  const records = benchmark.rows.map((row): HistoricalBenchmarkRecord => {
    const athleteName = clean(row[benchmark.columns["Athlete / Talent"]]);
    const evidenceRef = clean(row[benchmark.columns["Evidence ref"]]).toUpperCase();
    if (!athleteName || names.has(athleteName.toLowerCase())) throw new Error(`Missing or duplicate athlete: ${athleteName}`);
    if (!/^E\d{2,3}$/.test(evidenceRef) || refs.has(evidenceRef)) throw new Error(`Missing, invalid, or duplicate evidence reference: ${evidenceRef}`);
    names.add(athleteName.toLowerCase());
    refs.add(evidenceRef);
    const evidenceRow = evidenceByRef.get(evidenceRef);
    if (!evidenceRow) throw new Error(`Evidence Index is missing ${evidenceRef} for ${athleteName}`);
    if (clean(evidenceRow[evidence.columns["Athlete / Talent"]]) !== athleteName) {
      throw new Error(`Evidence Index athlete mismatch for ${evidenceRef}: ${athleteName}`);
    }
    return {
      athleteName,
      decisionDate: excelDate(row[benchmark.columns["Approx. decision date"]], `${athleteName} decision date`),
      fitAtTime: clean(row[benchmark.columns["OnlyFans fit at the time"]]) as HistoricalBenchmarkRecord["fitAtTime"],
      outcome: clean(row[benchmark.columns["Outcome"]]) as HistoricalBenchmarkRecord["outcome"],
      primaryReason: clean(row[benchmark.columns["Primary reason"]]),
      explanation: clean(row[benchmark.columns["One-sentence explanation"]]),
      evidenceRef,
      confidence: clean(row[benchmark.columns["Confidence"]]) as HistoricalBenchmarkRecord["confidence"],
      emailSubjects: clean(evidenceRow[evidence.columns["Email subject(s)"]]),
      relevantDates: clean(evidenceRow[evidence.columns["Relevant date(s)"]]),
      evidenceEstablishes: clean(evidenceRow[evidence.columns["What the evidence establishes"]]),
      evidenceNotes: clean(evidenceRow[evidence.columns["Notes / documents available"]]),
      evidenceDetails: detailRowsByAthlete.get(athleteName) || [],
    };
  });
  const outcomeCounts = Object.fromEntries(Array.from(new Set(records.map((record) => record.outcome))).sort()
    .map((outcome) => [outcome, records.filter((record) => record.outcome === outcome).length]));
  const expectedOutcomes = {
    "Signed": 41,
    "Approved but Did Not Sign": 3,
    "Rejected": 23,
    "Stalled": 33,
  };
  for (const [outcome, expected] of Object.entries(expectedOutcomes)) {
    if (outcomeCounts[outcome] !== expected) throw new Error(`Expected ${expected} ${outcome} records, received ${outcomeCounts[outcome] || 0}`);
  }
  const allDetails = records.flatMap((record) => record.evidenceDetails || []);
  const categoryCounts = Object.fromEntries(Array.from(new Set(allDetails.map((detail) => detail.claimCategory))).sort()
    .map((category) => [category, allDetails.filter((detail) => detail.claimCategory === category).length]));
  return {
    records,
    validation: {
      records: records.length,
      lockedDifferences,
      outcomeCounts,
      evidenceDetailRows: allDetails.length,
      evidenceDetailAthletes: records.filter((record) => (record.evidenceDetails || []).length > 0).length,
      evidenceDetailCategoryCounts: categoryCounts,
      highConfidenceDetails: allDetails.filter((detail) => detail.identityMatchConfidence === "High").length,
      mediumConfidenceDetails: allDetails.filter((detail) => detail.identityMatchConfidence === "Medium").length,
      lowConfidenceDetails: allDetails.filter((detail) => detail.identityMatchConfidence === "Low").length,
    },
  };
}
