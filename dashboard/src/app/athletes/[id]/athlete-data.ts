import type { Athlete } from "@/lib/supabase/types";

/** Stages the move endpoint (/api/pipeline/athletes POST) accepts, in order. */
export const STAGES = [
  { id: "research", label: "Research" },
  { id: "approval", label: "Approval" },
  { id: "reach_out", label: "Reach out" },
  { id: "response", label: "Response" },
  { id: "appointment", label: "Appointment" },
  { id: "contract", label: "Contract" },
] as const;

export function stageLabel(stage: string | null) {
  if (!stage) return "Not in pipeline";
  if (stage === "rejected") return "Rejected";
  return STAGES.find((item) => item.id === stage)?.label || stage;
}

export interface EnrichmentSourceRecord {
  source: "instagram" | "google" | "wikipedia" | "tiktok" | "onlyfans";
  status: "pending" | "running" | "complete" | "not_found" | "not_configured" | "failed";
  data: {
    title?: string;
    url?: string;
    results?: Array<{ title?: string; url?: string }>;
  };
}

export interface EnrichmentJob {
  id: string;
  source: EnrichmentSourceRecord["source"];
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  result?: Record<string, unknown>;
  last_error?: string | null;
}

export async function waitForEnrichmentJob(jobId: string): Promise<EnrichmentJob> {
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`/api/enrichment/jobs?jobId=${jobId}`, { cache: "no-store" });
    const payload = (await response.json()) as { job?: EnrichmentJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error || "Could not read refresh status");
    if (payload.job.status === "complete") return payload.job;
    if (payload.job.status === "failed" || payload.job.status === "cancelled") {
      throw new Error(payload.job.last_error || `Refresh ${payload.job.status}`);
    }
  }
  throw new Error("Still refreshing in the background. Check back later.");
}

export interface ParsedNotes {
  /** Research-agent notes (JSON object stored in `notes`). */
  research: Record<string, unknown>;
  /** Legacy `IG_DATA: {...}` block from seed data. */
  instagram: Record<string, unknown>;
  /** Legacy contract / OnlyFans fields from seed data. */
  contract: { year?: string; division?: string; of_username?: string; of_url?: string; contract_end?: string };
  /** Free-text notes left after structured data is removed. */
  text: string;
}

function extractIgData(notes: string) {
  const jsonStart = notes.indexOf("{", notes.indexOf("IG_DATA:"));
  if (jsonStart === -1) return {};
  let depth = 0;
  for (let i = jsonStart; i < notes.length; i++) {
    if (notes[i] === "{") depth++;
    if (notes[i] === "}") depth--;
    if (depth === 0) {
      try {
        return JSON.parse(notes.substring(jsonStart, i + 1)) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }
  return {};
}

export function parseNotes(notes: string | null): ParsedNotes {
  const result: ParsedNotes = { research: {}, instagram: {}, contract: {}, text: "" };
  if (!notes) return result;

  try {
    const parsed = JSON.parse(notes) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      result.research = parsed as Record<string, unknown>;
      return result;
    }
  } catch {
    // Not a research JSON note; fall through to the legacy format.
  }

  if (notes.includes("IG_DATA:")) result.instagram = extractIgData(notes);

  for (const chunk of notes.match(/\{[^{}]+\}/g) || []) {
    try {
      const data = JSON.parse(chunk) as Record<string, string | undefined>;
      for (const key of ["year", "division", "of_username", "of_url", "contract_end"] as const) {
        if (data[key] && !result.contract[key]) result.contract[key] = data[key];
      }
    } catch {
      // Not JSON; skip.
    }
  }
  const ofMatch = notes.match(/https:\/\/onlyfans\.com\/([a-zA-Z0-9_]+)/);
  if (ofMatch && !result.contract.of_url) {
    result.contract.of_url = ofMatch[0];
    result.contract.of_username ||= ofMatch[1];
  }
  const yearsMatch = notes.match(/Years:\s*([^|]+)/);
  if (yearsMatch && !result.contract.year) result.contract.year = yearsMatch[1].trim();

  result.text = notes
    .replace(/IG_DATA:\s*\{[^}]+\}/g, "")
    .replace(/\{[^{}]+\}/g, "")
    .replace(/Years:\s*[^|]+/g, "")
    .replace(/https:\/\/onlyfans\.com\/[a-zA-Z0-9_]+/g, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();
  return result;
}

export function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Header fit chip, from the research agent's 0–100 score (A/B/C/D). */
export function fitGrade(notes: ParsedNotes): { grade: string; title: string } | null {
  const score = asNumber(notes.research.research_score);
  if (score === undefined) return null;
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
  return { grade, title: `Research score ${Math.round(score)} of 100` };
}

export interface SourceLink {
  url: string;
  label: string;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function sourceLinks(
  athlete: Athlete,
  notes: ParsedNotes,
  sources: Partial<Record<EnrichmentSourceRecord["source"], EnrichmentSourceRecord>>
): SourceLink[] {
  const candidates: Array<{ url?: string; title?: string }> = [];
  const evidence = notes.research.source_evidence;
  if (Array.isArray(evidence)) candidates.push(...(evidence as Array<{ url?: string; title?: string }>));
  candidates.push({ url: asString(notes.research.age_source), title: "Age source" });
  candidates.push({ url: athlete.wikipedia_url || undefined, title: "Wikipedia" });
  if (sources.wikipedia?.status === "complete") candidates.push({ url: sources.wikipedia.data.url, title: "Wikipedia" });
  if (sources.google?.status === "complete") candidates.push(...(sources.google.data.results || []));

  const seen = new Set<string>();
  const links: SourceLink[] = [];
  for (const item of candidates) {
    if (!item?.url || !item.url.startsWith("http") || seen.has(item.url)) continue;
    seen.add(item.url);
    links.push({ url: item.url, label: item.title || hostname(item.url) });
    if (links.length === 4) break;
  }
  return links;
}

/** One-line OnlyFans status, or null when nothing is known. */
export function onlyFansStatus(
  athlete: Athlete,
  notes: ParsedNotes,
  sources: Partial<Record<EnrichmentSourceRecord["source"], EnrichmentSourceRecord>>
): { text: string; url?: string } | null {
  const url =
    athlete.onlyfans_url ||
    notes.contract.of_url ||
    (sources.onlyfans?.status === "complete" ? sources.onlyfans.data.url : undefined) ||
    undefined;
  const platformStatus = asString(notes.research.onlyfans_platform_status);
  if (platformStatus === "active" || platformStatus === "inactive") return { text: platformStatus, url };
  if (url || athlete.has_onlyfans === true) return { text: "has a profile", url };
  if (athlete.has_onlyfans === false) return { text: "no" };
  return null;
}
