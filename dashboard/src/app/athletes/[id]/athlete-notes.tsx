import type { Athlete } from "@/lib/supabase/types";
import { formatDate } from "@/lib/utils";
import type { ParsedNotes } from "./athlete-data";

/** Research-note keys already shown elsewhere on the page. */
const SHOWN_ELSEWHERE = new Set(["research_reasoning", "concerns", "age_verified", "age", "source_evidence", "score_breakdown"]);

function humanize(key: string) {
  const text = key.replace(/^IG /, "Instagram ").replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function display(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((item) => display(item) ?? "").filter(Boolean).join(", ") : null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function AthleteNotes({ athlete, notes }: { athlete: Athlete; notes: ParsedNotes }) {
  const rows: Array<[string, unknown]> = [
    ["ID", athlete.id],
    ["Email", athlete.email],
    ["Instagram URL", athlete.instagram_url],
    ["Country", athlete.country],
    ["Age (profile)", athlete.age],
    ["Engagement rate", athlete.engagement_rate != null ? `${athlete.engagement_rate}%` : null],
    ["Wikipedia", athlete.wikipedia_url],
    ["Profile URL", athlete.profile_url],
    ["TikTok", athlete.tiktok_url || athlete.tiktok_handle],
    ["Twitter", athlete.twitter_url || athlete.twitter_handle],
    ["Data status", athlete.enrichment_status],
    ["Added by", athlete.source?.replaceAll("_", " ")],
    ["Added", formatDate(athlete.created_at)],
    ["Updated", athlete.updated_at ? formatDate(athlete.updated_at) : null],
    ...Object.entries(notes.instagram).map(([key, value]): [string, unknown] => [`IG ${key}`, value]),
    ...Object.entries(notes.contract).map(([key, value]): [string, unknown] => [key, value]),
    ...Object.entries(notes.research)
      .filter(([key]) => !SHOWN_ELSEWHERE.has(key))
      .map(([key, value]): [string, unknown] => [key, value]),
  ];
  const details = rows
    .map(([label, value]) => [label, display(value)] as const)
    .filter((row): row is readonly [string, string] => row[1] !== null);

  return (
    <section aria-labelledby="notes-heading">
      <h2 id="notes-heading" className="pc-section-heading">Notes</h2>
      <div className="pc-surface mt-3 p-4">
        {notes.text ? (
          <p className="whitespace-pre-wrap text-sm text-brand-ink">{notes.text}</p>
        ) : (
          <p className="text-sm text-brand-muted">No notes.</p>
        )}
        <details className="mt-4 border-t border-brand-line pt-3">
          <summary className="cursor-pointer text-xs font-medium text-brand-blue">All details</summary>
          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
            {details.map(([label, value], index) => (
              <div key={`${label}-${index}`} className="contents">
                <dt className="font-medium text-brand-muted sm:py-0.5">{humanize(label)}</dt>
                <dd className="mb-1.5 min-w-0 text-brand-ink [overflow-wrap:anywhere] sm:mb-0 sm:py-0.5">
                  {value.startsWith("http") ? (
                    <a href={value} target="_blank" rel="noopener noreferrer" className="text-brand-blue">{value}</a>
                  ) : value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </section>
  );
}
