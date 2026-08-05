export const FUNNEL_STAGE_ORDER = [
  "research",
  "approval",
  "reach_out",
  "response",
  "appointment",
  "contract",
] as const;

export type FunnelStageName = (typeof FUNNEL_STAGE_ORDER)[number];

export type FunnelAthlete = {
  id: string;
  pipeline_stage: string | null;
};

export type FunnelTransition = {
  athlete_id: string;
  to_stage: string | null;
};

export type FunnelStageResult = {
  name: FunnelStageName;
  count: number;
  percent: number;
};

function addReachedThrough(reached: Set<FunnelStageName>, stage: string | null) {
  const stageIndex = FUNNEL_STAGE_ORDER.indexOf(stage as FunnelStageName);
  if (stageIndex < 0) return;

  // The final funnel step means a signed contract. Merely moving a card into
  // the Contract column proves progression through Appointment, not conversion.
  const lastProgressionIndex = Math.min(stageIndex, FUNNEL_STAGE_ORDER.length - 2);
  FUNNEL_STAGE_ORDER.slice(0, lastProgressionIndex + 1).forEach((name) =>
    reached.add(name)
  );
}

export function buildFunnelStages(
  athletes: FunnelAthlete[],
  history: FunnelTransition[],
  signedContractAthleteIds: Iterable<string>
): FunnelStageResult[] {
  const reachedByAthlete = new Map<string, Set<FunnelStageName>>();

  for (const athlete of athletes) {
    const reached = new Set<FunnelStageName>(["research"]);
    addReachedThrough(reached, athlete.pipeline_stage);
    reachedByAthlete.set(athlete.id, reached);
  }

  for (const transition of history) {
    const reached = reachedByAthlete.get(transition.athlete_id);
    if (reached) addReachedThrough(reached, transition.to_stage);
  }

  for (const athleteId of signedContractAthleteIds) {
    const reached = reachedByAthlete.get(athleteId);
    if (!reached) continue;
    FUNNEL_STAGE_ORDER.forEach((stage) => reached.add(stage));
  }

  const cohortSize = athletes.length;
  return FUNNEL_STAGE_ORDER.map((name) => {
    const count = [...reachedByAthlete.values()].filter((reached) =>
      reached.has(name)
    ).length;
    return {
      name,
      count,
      percent: cohortSize > 0 ? Math.round((count / cohortSize) * 100) : 0,
    };
  });
}

export function analyticsPeriodStart(period: string) {
  const match = period.match(/^(\d+)d$/);
  if (!match) return null;
  const start = new Date();
  start.setDate(start.getDate() - Number(match[1]));
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}
