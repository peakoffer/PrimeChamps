import {
  SPONSOR_APPROVAL_CLEAR_WINNER_MIN,
  SPONSOR_APPROVAL_SECOND_TIER_MIN,
} from "./sponsor-approval-profile.ts";

// Grading for sponsor-approval checks, fixed by
// docs/calibration/outcome-targets.md and preregistration-2026-09-29.md.
export type PlatformDecision = "approved" | "rejected" | "undecided";

export function platformDecision(finalOutcome: string | null | undefined, explanation: string | null | undefined): PlatformDecision {
  const outcome = (finalOutcome || "").trim().toLowerCase();
  if (outcome === "signed" || outcome === "non_signing") return "approved";
  if (outcome === "onlyfans_rejected") return "rejected";
  if (outcome !== "stalled") return "undecided";
  const text = explanation || "";
  if (/no OnlyFans decision/i.test(text)) return "undecided";
  return /approved/i.test(text) ? "approved" : "undecided";
}

// The 30 records scored blind on 2026-09-29 (docs/calibration/blind-holdout-2026-09-29.md).
export const SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS = new Set([
  "85629497-191a-45c3-a626-df368877cb1f", "e343f9f5-10f5-401e-bfde-46c9154617e1", "2b48a7b9-cd60-4b37-afaa-62e089120c87",
  "f5b6dd3c-4fd5-4025-852e-09369df3b9ed", "9b2bd66a-68eb-4b3d-be14-c88dba3cc015", "3fe69fae-14a7-44ac-a9b0-ddf1c4b49d61",
  "dcf75c6c-1267-4e6f-bc5d-93d725f84316", "3d9c7bdb-bc7d-4611-b57a-fe8674b322cd", "a5dab876-2021-49ac-993f-976a33d54cdf",
  "cb6d5000-40d1-43a6-ae65-b5d8fb5df87d", "b5087a94-8284-4b35-9d80-1930aca60cdf", "8ff846b5-d96f-4b66-844e-90186c77df59",
  "f77e4fba-f90d-46df-aa59-d364985e67a4", "eb812cfd-ecc9-4f78-a00d-d903dd7eb772", "d3da2745-73dc-44a6-8e9f-162d9447c231",
  "7b20a35b-ea24-452d-aa81-5d4ce02edbb8", "34e7d4d7-7fac-4258-b006-4b80f6cb6e22", "7bf050a0-0e25-42c0-ba27-363349a1a33a",
  "4f8dc1f9-a248-47e9-add1-015dd173d1c8", "6e4fd66b-9806-4ab2-876f-6a2dde70c4fd", "f31282e9-9a47-4be5-a949-132e7a177335",
  "3acde854-f19c-48a1-98f3-208dbb9d7b82", "3afac948-69c4-4603-87b5-90b002bd5ab6", "e055f5ce-36a6-4894-8b64-3292256e763d",
  "1d3ee1b1-ff56-4958-9a2e-d552c4ee44af", "b63b3077-31f9-49ce-b37c-0a07acf45ca5", "0ab8ef92-287a-4d8c-982a-6908433546ca",
  "1641e3c2-59cc-4257-82cc-2df63d837203", "5930037b-c944-4152-aa3f-7f9ed06125d8", "6edc9851-cab1-466d-8026-3e33b9444863",
]);

// Pre-registered ship conditions for letting the estimate drive ranking.
export const SPONSOR_APPROVAL_MINIMUM_AUC = 0.65;

export interface SponsorApprovalGradedRow {
  goldenRecordId: string;
  probability: number;
  decision: PlatformDecision;
}

export interface SponsorApprovalThresholdResult {
  threshold: number;
  flagged: number;
  approvedFlagged: number;
  approvedTotal: number;
  rejectionsBelow: number;
  rejectedTotal: number;
}

export interface SponsorApprovalSliceScorecard {
  decided: number;
  approved: number;
  rejected: number;
  undecided: number;
  baseRate: number | null;
  auc: number | null;
  thresholds: SponsorApprovalThresholdResult[];
}

export interface SponsorApprovalScorecard {
  all: SponsorApprovalSliceScorecard;
  calibration: SponsorApprovalSliceScorecard;
  blind: SponsorApprovalSliceScorecard;
  passes: boolean;
  passReasons: string[];
}

// Probability that a random approved pitch outranks a random rejected one; ties count half.
export function rankAuc(positives: number[], negatives: number[]) {
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  }
  return wins / (positives.length * negatives.length);
}

function slice(rows: SponsorApprovalGradedRow[]): SponsorApprovalSliceScorecard {
  const approved = rows.filter((row) => row.decision === "approved");
  const rejected = rows.filter((row) => row.decision === "rejected");
  const decided = approved.length + rejected.length;
  return {
    decided,
    approved: approved.length,
    rejected: rejected.length,
    undecided: rows.length - decided,
    baseRate: decided ? approved.length / decided : null,
    auc: rankAuc(approved.map((row) => row.probability), rejected.map((row) => row.probability)),
    thresholds: [SPONSOR_APPROVAL_CLEAR_WINNER_MIN, SPONSOR_APPROVAL_SECOND_TIER_MIN].map((threshold) => {
      const flaggedApproved = approved.filter((row) => row.probability >= threshold).length;
      const flaggedRejected = rejected.filter((row) => row.probability >= threshold).length;
      return {
        threshold,
        flagged: flaggedApproved + flaggedRejected,
        approvedFlagged: flaggedApproved,
        approvedTotal: approved.length,
        rejectionsBelow: rejected.length - flaggedRejected,
        rejectedTotal: rejected.length,
      };
    }),
  };
}

export function sponsorApprovalScorecard(rows: SponsorApprovalGradedRow[]): SponsorApprovalScorecard {
  const all = slice(rows);
  const blind = slice(rows.filter((row) => SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS.has(row.goldenRecordId)));
  const calibration = slice(rows.filter((row) => !SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS.has(row.goldenRecordId)));
  const clearWinners = all.thresholds.find((item) => item.threshold === SPONSOR_APPROVAL_CLEAR_WINNER_MIN)!;
  const clearWinnerPrecision = clearWinners.flagged ? clearWinners.approvedFlagged / clearWinners.flagged : null;
  const passReasons: string[] = [];
  if (all.auc === null || all.auc < SPONSOR_APPROVAL_MINIMUM_AUC) {
    passReasons.push(`AUC ${all.auc === null ? "unavailable" : all.auc.toFixed(2)} is below ${SPONSOR_APPROVAL_MINIMUM_AUC}`);
  }
  if (clearWinnerPrecision === null || all.baseRate === null || clearWinnerPrecision <= all.baseRate) {
    passReasons.push(clearWinnerPrecision === null
      ? "No record reached the clear-winner threshold"
      : `Clear-winner precision ${Math.round(clearWinnerPrecision * 100)}% does not beat the ${Math.round((all.baseRate || 0) * 100)}% base rate`);
  }
  return { all, calibration, blind, passes: passReasons.length === 0, passReasons };
}
