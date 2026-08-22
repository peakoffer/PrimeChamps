export type PriorAgeSafetyCandidate = {
  name: string;
  sport: string;
  instagramHandle: string;
};

export type PriorAgeSafetyRow = {
  research_log_id: string;
  name: string;
  sport: string;
  instagram_handle: string | null;
  identity_status: string;
  age: number | null;
  age_verified: boolean;
  age_source: string | null;
  source_evidence: unknown;
  gate_results: unknown;
  updated_at: string;
};

function key(value: unknown) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function selectFreshPriorUnder21SafetyEvidence(input: {
  candidate: PriorAgeSafetyCandidate;
  currentResearchLogId: string;
  targetAgeMin: number;
  rows: PriorAgeSafetyRow[];
  nowMs?: number;
  maximumAgeMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const maximumAgeMs = input.maximumAgeMs ?? 7 * 86_400_000;
  return input.rows.find((row) => {
    if (row.research_log_id === input.currentResearchLogId) return false;
    if (key(row.name) !== key(input.candidate.name) || key(row.sport) !== key(input.candidate.sport)) return false;
    if (String(row.instagram_handle || "").toLowerCase() !== input.candidate.instagramHandle.toLowerCase()) return false;
    if (row.identity_status !== "verified" || row.age_verified !== true) return false;
    if (typeof row.age !== "number" || row.age < 10 || row.age >= input.targetAgeMin) return false;
    const updatedAt = Date.parse(row.updated_at);
    if (!Number.isFinite(updatedAt) || nowMs - updatedAt < 0 || nowMs - updatedAt > maximumAgeMs) return false;
    const gates = object(row.gate_results);
    if (gates.age_corroborated !== true) return false;
    const sources = Array.isArray(gates.age_sources) ? gates.age_sources.map(object) : [];
    const hostnames = new Set(sources.flatMap((source) =>
      typeof source.hostname === "string" && source.hostname.trim() ? [source.hostname.toLowerCase()] : []
    ));
    return sources.length >= 2 && hostnames.size >= 2
      && sources.every((source) => Number(source.age) === row.age);
  }) || null;
}
