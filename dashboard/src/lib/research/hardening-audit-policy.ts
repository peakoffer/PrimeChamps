type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

export function buildShadowEvidencePacket(input: {
  sourceEvidence: unknown[];
  gateResults: RecordValue;
  rawCandidate: RecordValue;
}) {
  // Preserve gate support AND contradictions. Array position is never a
  // relevance signal, and truncation can remove the sole age/contact source.
  return {
    gates: input.gateResults,
    evidence: input.sourceEvidence.map((value, index) => ({ reference_id: `SOURCE-${index + 1}`, value })),
    candidate_snapshot: input.rawCandidate,
  };
}

export function shadowEvidenceReferences(packet: ReturnType<typeof buildShadowEvidencePacket>) {
  const refs = new Set<string>();
  function visit(value: unknown, key = "") {
    if (typeof value === "string") {
      if (/^(?:https?:\/\/)/i.test(value) || /^(?:reference_id|evidence_id|source_id|evidence_ref|ref|id)$/i.test(key)) {
        if (value.trim()) refs.add(value.trim());
      }
    } else if (Array.isArray(value)) value.forEach((entry) => visit(entry, key));
    else if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    }
  }
  visit(packet);
  return refs;
}

export type ValidatedShadowAudit = {
  candidate_id: string;
  verdict: "agree" | "unsafe_finalist" | "missed_strong_fit" | "insufficient_evidence";
  issue_category: string;
  severity: "critical" | "high" | "medium" | "low";
  summary: string;
  evidence_refs: string[];
};

export function validateShadowAuditRows(
  value: unknown,
  candidates: Array<{ id: string; packet: ReturnType<typeof buildShadowEvidencePacket> }>,
  allowedCategories: readonly string[]
): ValidatedShadowAudit[] {
  if (!Array.isArray(value) || value.length !== candidates.length) throw new Error("Opus must return exactly one audit for every candidate");
  const expected = new Map(candidates.map((candidate) => [candidate.id, shadowEvidenceReferences(candidate.packet)]));
  if (expected.size !== candidates.length) throw new Error("Duplicate candidate identity in shadow audit request");
  const seen = new Set<string>();
  const verdicts = new Set(["agree", "unsafe_finalist", "missed_strong_fit", "insufficient_evidence"]);
  const severities = new Set(["critical", "high", "medium", "low"]);
  return value.map((raw) => {
    const row = record(raw);
    const id = typeof row.candidate_id === "string" ? row.candidate_id : "";
    const allowedRefs = expected.get(id);
    if (!allowedRefs || seen.has(id)) throw new Error("Opus returned a duplicate or unexpected candidate audit");
    seen.add(id);
    if (!verdicts.has(String(row.verdict)) || !severities.has(String(row.severity))
      || !allowedCategories.includes(String(row.issue_category))
      || typeof row.summary !== "string" || !row.summary.trim()
      || !Array.isArray(row.evidence_refs)) throw new Error(`Invalid Opus audit for ${id}`);
    const refs = row.evidence_refs;
    if (refs.some((ref) => typeof ref !== "string" || !allowedRefs.has(ref))) {
      throw new Error(`Opus cited evidence outside candidate ${id}'s frozen dossier`);
    }
    if ((row.verdict === "unsafe_finalist" || row.verdict === "missed_strong_fit") && refs.length === 0) {
      throw new Error(`Opus finding for ${id} requires a dossier citation`);
    }
    return {
      candidate_id: id,
      verdict: row.verdict as ValidatedShadowAudit["verdict"],
      issue_category: String(row.issue_category),
      severity: row.severity as ValidatedShadowAudit["severity"],
      summary: row.summary.trim(),
      evidence_refs: Array.from(new Set(refs as string[])),
    };
  });
}
