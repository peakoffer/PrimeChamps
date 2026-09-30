// Sponsor-approval profile validated against Dylan's 100 historical OnlyFans
// pitch outcomes (docs/calibration/). On the 30-record blind hold-out it ranked
// approved above rejected pitches with AUC 0.88, and every candidate at or above
// the clear-winner threshold was approved (10/10, base rate 77%). A neutral
// rubric scored no better than chance, and softening these factors made the
// scorer worse, so the wording below is kept as validated.
export const SPONSOR_APPROVAL_PROFILE_VERSION = "sponsor-approval-2026-09-29";

export const SPONSOR_APPROVAL_CLEAR_WINNER_MIN = 60;
export const SPONSOR_APPROVAL_SECOND_TIER_MIN = 50;

export type SponsorApprovalTier = "clear_winner" | "second_tier" | "unlikely";

export const SPONSOR_APPROVAL_PROFILE = `SPONSOR APPROVAL PROFILE (${SPONSOR_APPROVAL_PROFILE_VERSION})
Estimate sponsor_approval_probability (0-100): how likely OnlyFans' sports sponsorship team is to approve a paid sponsorship pitch for this athlete now. Weigh what the sponsor historically values; none alone is decisive:
- Must be 21+. Evidence of under-21 means at most 10. Unverified age is NOT a reason to lower this probability; age is enforced separately as a hard gate.
- Active, current competitor in a sport with visible branding inventory the sponsor can use: fight kit/shorts/robes, race suit or vehicle livery, board, bike, boat, event appearances. Niche, action, water, motor and combat sports fit well. Strict league or promotion kit exclusivity (e.g. uniform rules that limit personal sponsor logos) reduces usable inventory.
- A meaningful personal audience for the athlete's tier and genuine creator behavior (training, behind-the-scenes, personality-led posts).
- Realistic price tier: accessible, mid-tier and rising athletes are favored; global stars and record-holders whose likely fees exceed comparable deals are often declined. Judge the tier from public career stature when no fee is known.
- Existing, active OnlyFans creator activity is a strong positive; an existing but inactive or abandoned OnlyFans profile is a strong negative (the sponsor prefers to see organic platform use first).
- Current availability: a known long injury layoff, retirement or no longer competing, a season already too far advanced, or no upcoming events is a negative.
- Renewal of an existing OnlyFans sponsorship is strongly positive.
- When evidence is thin, keep the probability moderate (40-65) and say so; missing evidence is not evidence of a bad fit.
Calibration: ${SPONSOR_APPROVAL_CLEAR_WINNER_MIN}+ is a clear winner and should be rare; ${SPONSOR_APPROVAL_SECOND_TIER_MIN}-${SPONSOR_APPROVAL_CLEAR_WINNER_MIN - 1} is a credible second-tier pitch; below ${SPONSOR_APPROVAL_SECOND_TIER_MIN} is unlikely to be approved. Never raise this probability to fill a candidate quota.`;

export function sponsorApprovalProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

export function sponsorApprovalTier(probability: number | null | undefined): SponsorApprovalTier | null {
  if (typeof probability !== "number" || !Number.isFinite(probability)) return null;
  if (probability >= SPONSOR_APPROVAL_CLEAR_WINNER_MIN) return "clear_winner";
  if (probability >= SPONSOR_APPROVAL_SECOND_TIER_MIN) return "second_tier";
  return "unlikely";
}

// Candidates without an estimate (older runs, or a missing field) rank as
// second tier: unknown is neither promoted nor buried.
export function sponsorApprovalRank(tier: SponsorApprovalTier | null | undefined) {
  return tier === "clear_winner" ? 2 : tier === "unlikely" ? 0 : 1;
}

// Validated by the Sonnet check on 2026-09-30 (AUC 0.74, clear winners 12/13
// approved against a 77% base rate): tier first, then the priority score.
export function compareBySponsorApproval(
  left: { sponsor_approval_tier?: SponsorApprovalTier | null; score?: number | null },
  right: { sponsor_approval_tier?: SponsorApprovalTier | null; score?: number | null },
) {
  return sponsorApprovalRank(right.sponsor_approval_tier) - sponsorApprovalRank(left.sponsor_approval_tier)
    || Number(right.score ?? 0) - Number(left.score ?? 0);
}

// Historical workbook detail sometimes restates the sponsor's reaction to the
// pitch ("fee too high", "internal review found it too expensive", "described
// as too small"). That is the outcome, not pre-decision evidence, and three
// such items were found in the blind hold-out alone.
const SPONSOR_REACTION_PATTERN = new RegExp([
  String.raw`\btoo (?:expensive|pricey|small|high|low)\b`,
  String.raw`\bvery pricey\b`,
  String.raw`\bdescribed as (?:too|not)\b`,
  String.raw`\b(?:onlyfans|the sponsor|the team|sponsor team|internal review)\b[^.]{0,60}\b(?:passed (?:on|internally|after)|declined|rejected|approved|countered|not interested|no strong interest)\b`,
  String.raw`\b(?:passed on|declined|rejected) (?:the )?(?:pitch|proposal|partnership|sponsorship|deal)\b`,
  String.raw`\bstructure (?:was )?discussed\b`,
  String.raw`\bkind pass\b`,
].join("|"), "i");

export function isSponsorReactionClaim(text: string | null | undefined) {
  return typeof text === "string" && SPONSOR_REACTION_PATTERN.test(text);
}
