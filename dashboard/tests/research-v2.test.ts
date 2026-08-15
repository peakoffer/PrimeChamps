import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assignGoldenRecordSplits,
  auditPipelineCaughtResearcherFailure,
  selectBalancedChallengeHoldout,
  calculateBenchmarkMetrics,
  evaluateBenchmarkReleaseReadiness,
  freshBenchmarkLabelDeficits,
  goldenAthleteKey,
  isGoldenRecordReadyForSplit,
  maskGoldenRecordForBlindLabeling,
  parseGoldenRecordInput,
  selectActiveBenchmarkCohort,
  stratifiedSample,
  summarizeGoldenRecords,
} from "../src/lib/research/v2.ts";

test("fresh evidence recovery stops spending on a label whose quota is full", () => {
  const entries = [
    ...Array.from({ length: 5 }, () => ({ fitLabel: "fit" as const, ready: true })),
    ...Array.from({ length: 16 }, () => ({ fitLabel: "not_fit" as const, ready: true })),
    { fitLabel: "fit" as const, ready: false },
    { fitLabel: "not_fit" as const, ready: false },
  ];
  assert.deepEqual(freshBenchmarkLabelDeficits(entries), { fit: 11, not_fit: 0 });
});

test("benchmark evidence storage batches records below the database row ceiling", () => {
  const loader = readFileSync(new URL("../src/lib/research/benchmark-evidence-storage.ts", import.meta.url), "utf8");
  assert.match(loader, /chunkRecordIds\(input\.recordIds\)/);
  assert.match(loader, /size = 20/);
  assert.match(loader, /\.limit\(1_000\)/);
  assert.match(loader, /batches\.flatMap/);
});
import {
  buildAuditorConstrainedResearchV2Score,
  buildResearchV2Score,
  hasMeaningfulPersonalAudience,
  hasSourceBackedResearchV2Signal,
  holdResearchV2PriorityForIndependentAudit,
  passesResearchV2FinalGate,
  researchV2CitedSignalIsSourceBacked,
  stableEvidenceSetHash,
} from "../src/lib/research/v2-scoring.ts";
import { sanitizeUnicodeForJson } from "../src/lib/research/text-safety.ts";
import { applyResearchObjectiveScoreGuardrails } from "../src/lib/research/scoring.ts";
import {
  historicalOutcomeGroundTruth,
  historicalBenchmarkNamesMatch,
  prepareHistoricalBenchmarkRecord,
  reconcileHistoricalGoldenRecord,
  type HistoricalBenchmarkRecord,
} from "../src/lib/research/historical-benchmark.ts";
import {
  getResearchEvaluationBudget,
  normalizeResearchEvaluationProfile,
} from "../src/lib/research/evaluation-budget.ts";
import { selectBalancedResearchCandidates } from "../src/lib/research/candidate-selection.ts";
import {
  benchmarkSourceNamesAthlete,
  benchmarkSourceDomain,
  benchmarkSourceSupportsSport,
  benchmarkSportHints,
  groupBenchmarkSearchResults,
  validateBenchmarkSportClassification,
} from "../src/lib/research/benchmark-sport-validation.ts";
import {
  benchmarkAdultEligibilityGate,
  benchmarkCorroboratedAgeAtCutoff,
  benchmarkCaseReadiness,
  benchmarkCurrentMomentumGate,
  benchmarkCreatorPotentialGate,
  benchmarkEvidenceFreezeReadiness,
  benchmarkIdentityGate,
  benchmarkOnlyFansPlatformActivityGate,
  buildBenchmarkResearcherPrompt,
  benchmarkDeterministicGateSummary,
  canonicalBenchmarkMaterialClaims,
  compactBenchmarkModelEvidence,
  estimateBenchmarkCostMicrousd,
  evaluateBenchmarkMaterialClaimCitations,
  parseBenchmarkStructuredJson,
  normalizeOpenRouterBenchmarkUsage,
  promptContainsBenchmarkLeakage,
  projectedBenchmarkCallCostMicrousd,
  selectLatestOpenRouterSonnet,
  selectLeakageSafeBenchmarkEvidence,
  validateBenchmarkStructuredValue,
  sonnetPriceSnapshot,
  summarizeBenchmarkEvidenceReadiness,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "../src/lib/research/benchmark-runner-support.ts";
import { selectOnlyFansPlatformSignal } from "../src/lib/research/onlyfans-platform-signal.ts";
import {
  prepareHistoricalEvidenceDetails,
  prepareHistoricalSocialSnapshot,
} from "../src/lib/research/historical-social-snapshot.ts";
import { prepareHistoricalInstagramSnapshot } from "../src/lib/research/historical-instagram-history.ts";
import {
  diagnoseSocialBladeInstagramResponse,
  inspectSocialBladeCredentials,
  prepareApifyPublicSocialBladeInstagramSnapshot,
  prepareSocialBladeInstagramSnapshot,
  socialBladeHistoryTierForCutoff,
} from "../src/lib/research/social-blade-history.ts";
import { convertOnlyFansHistoricalWorkbookExtraction } from "../src/lib/research/historical-workbook-converter.ts";
import {
  buildOfficialDatedProfileCandidates,
  buildStoredPreparedEvidenceReplayCandidates,
  buildHistoricalAgeRecoveryQueries,
  buildHistoricalEvidenceQueries,
  buildHistoricalSignalRecoveryQueries,
  canonicalHistoricalArchiveUrl,
  commonCrawlIndexUrl,
  dedupeHistoricalSearchCandidates,
  extractCommonCrawlWarcBody,
  extractOfficialCompetitionEntryAdultEvidence,
  extractOfficialCommissionAdultEvidence,
  extractOfficialDatedProfileEvidence,
  extractPublishedAt,
  extractWikimediaExternalProfileCandidates,
  extractAttributedInstagramHandle,
  extractPreparedArchivedEvidence,
  extractPreparedDatedArticleEvidence,
  groundedHistoricalSignalDiscoveryCandidates,
  HISTORICAL_ARCHIVE_PROVIDER_VERSION,
  HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION,
  HISTORICAL_SIGNAL_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS,
  historicalDiscoveryReplayCoverageMatches,
  isPublicHttpUrl,
  normalizeWikipediaWikitext,
  normalizeEvidencePreparationBudget,
  parseWaybackTimestamp,
  preparedEvidenceSignalExcerptForAthlete,
  preparedMomentumEffectiveAt,
  preparedEvidenceSignalSupported,
  selectCommonCrawlCapture,
  selectCommonCrawlCollections,
  selectWikimediaRevisionCapture,
  selectWikimediaSearchCandidates,
  selectWaybackCapture,
  selectWaybackAvailabilityCapture,
  selectWaybackRedirectCapture,
  validatePreparedAgeEvidenceForSource,
  waybackCdxUrl,
  waybackAvailabilityUrl,
  waybackTimegateUrl,
  wikimediaRevisionApiUrl,
  wikimediaSearchApiUrl,
} from "../src/lib/research/historical-evidence-preparation.ts";

test("historical motorcycle racing accepts road-racing and WorldWCR evidence", () => {
  assert.equal(benchmarkSourceSupportsSport(
    "Motorcycle racing",
    "Tayla Relph is an Australian road racing athlete competing in WorldWCR."
  ), true);
});

test("benchmark identity matching folds non-decomposing Latin letters", () => {
  assert.equal(
    benchmarkSourceNamesAthlete(
      "Maks Płuciennik",
      "Maks Pluciennik is a 25-year-old BMX Street rider from Poland.",
    ),
    true,
  );
});

test("historical motorcycle racing accepts explicit Spanish motorcycle evidence", () => {
  assert.equal(
    benchmarkSourceSupportsSport(
      "Motorcycle Road Racing",
      "Pakita Ruiz compite en motociclismo en el Mundial femenino de velocidad",
    ),
    true,
  );
  assert.equal(
    benchmarkSourceSupportsSport(
      "Motorcycle Road Racing",
      "Pakita Ruiz is a generic racing driver",
    ),
    false,
  );
  assert.equal(
    benchmarkSourceSupportsSport(
      "Motorsports",
      "Maria Herrera appears on the official WorldWCR biographical entry list",
    ),
    true,
  );
});

test("surfing evidence accepts explicit Spanish and French athlete terms", () => {
  assert.equal(benchmarkSourceSupportsSport("Surfing", "Violeta Sanchez es surfista profesional"), true);
  assert.equal(benchmarkSourceSupportsSport("Surfing", "Violeta Sanchez est une surfeuse professionnelle"), true);
});

test("archived Spanish birthday reporting is attributable without treating childhood ages as current", () => {
  const currentAge = validatePreparedAgeEvidenceForSource({
    athleteName: "Pakita Ruiz",
    title: "Pakita Ruiz celebra su cumpleaños en el Mundial",
    domain: "ultimahora.es",
    observedAt: new Date("2024-08-11T18:56:00Z"),
    text: "Pakita Ruiz, que este domingo cumplía 27 años, terminó quinta en el Mundial femenino de velocidad.",
  });
  assert.equal(currentAge.attributableAge?.parsed.age, 27);
  assert.equal(currentAge.attributableAge?.parsed.precision, "stated_age");

  const appositiveAge = validatePreparedAgeEvidenceForSource({
    athleteName: "Violeta Sanchez",
    title: "A profile mentioning Violeta Sanchez",
    domain: "publisher.es",
    observedAt: new Date("2024-01-22T12:00:00Z"),
    text: "La surfista Violeta Sánchez, una joven de (entonces) 22 años, vivía en Cantabria.",
  });
  assert.equal(appositiveAge.attributableAge?.parsed.age, 22);

  const frenchAppositiveAge = validatePreparedAgeEvidenceForSource({
    athleteName: "Estelle Poret",
    title: "Champions de jet ski: les Poret sont tombés dedans quand ils étaient petits",
    domain: "leprogres.fr",
    observedAt: new Date("2020-01-08T12:12:00Z"),
    text: "Estelle Poret, 23 ans, est vice-championne du monde de jet ski.",
  });
  assert.equal(frenchAppositiveAge.attributableAge?.parsed.age, 23);

  const childhoodAge = validatePreparedAgeEvidenceForSource({
    athleteName: "Pakita Ruiz",
    title: "Pakita Ruiz profile",
    domain: "example.es",
    observedAt: new Date("2024-08-11T18:56:00Z"),
    text: "Pakita Ruiz tenía 16 años cuando empezó y compite desde los tres años.",
  });
  assert.equal(childhoodAge.attributableAge, null);
});

test("archived boxing tables do not attach the following category birth year to the prior athlete", () => {
  const result = validatePreparedAgeEvidenceForSource({
    athleteName: "Maisey Rose Courtney",
    domain: "strefa.pl",
    title: "England Talent Results 2018",
    observedAt: new Date("2025-08-10T07:46:52.000Z"),
    text: `2018-02-18
54kg
Chloe Morris
Maisey-Rose
Courtney
2018-02-18
57kg
Elise Glynn
Ellie Wilson
Finals male (born 2001)
2018-02-18`,
  });
  assert.equal(result.attributableAge, null);
  assert.equal(result.officialCompactBirthDate, null);
});

test("archived athlete features do not promote a childhood milestone into adult eligibility", () => {
  const result = validatePreparedAgeEvidenceForSource({
    athleteName: "Tayla Relph",
    domain: "abc.net.au",
    title: "Australia's fastest female motorcycle road racer Tayla Relph",
    observedAt: new Date("2025-07-24T20:51:14.000Z"),
    text: `Twenty-four years ago, Tayla Relph's parents took their then toddler daughter to a Crusty Demons meet.
Tayla Relph was barely three when she got her first motorbike.
Then at 10 years old she began racing competitively.`,
  });
  assert.equal(result.attributableAge, null);
  assert.equal(result.officialCompactBirthDate, null);
});

test("archived JSON-LD article bodies remain available for exact athlete evidence", () => {
  const prepared = extractPreparedArchivedEvidence({
    record: {
      id: "violeta",
      athlete_name: "Violeta Sanchez",
      sport: "Surfing",
      fit_label: "fit",
      evidence_cutoff_at: "2026-08-04T12:00:00Z",
    },
    candidate: {
      query: "operator supplied",
      title: "Violeta Sanchez athlete profile",
      url: "https://publisher.example/violeta",
      snippet: "Violeta Sanchez is a professional surfer.",
    },
    capture: {
      timestamp: "20230519000506",
      capturedAt: "2023-05-19T00:05:06Z",
      originalUrl: "https://publisher.example/violeta",
      statusCode: "200",
      digest: "digest",
      mimeType: "text/html",
      archivedUrl: "https://web.archive.org/example",
    },
    html: `<html><head><title>Violeta Sanchez athlete profile</title><script type="application/ld+json">${JSON.stringify({
      "@type": "NewsArticle",
      datePublished: "2023-05-10T08:00:00Z",
      headline: "Violeta Sanchez athlete profile",
      articleBody: "Violeta Sanchez es surfista profesional. Violeta tiene 22 años y compite internacionalmente.",
    })}</script></head><body></body></html>`,
  });
  assert.equal(prepared.rejectionReason, null);
  assert.equal(prepared.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"), true);
  const newsAge = prepared.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(newsAge?.effectiveAt, "2023-05-10T08:00:00.000Z");
  assert.equal(newsAge?.structuredValue.age_as_of, "2023-05-10T08:00:00.000Z");

  const staticNewsBody = extractPreparedArchivedEvidence({
    record: {
      id: "violeta-static",
      athlete_name: "Violeta Sanchez",
      sport: "Surfing",
      fit_label: "fit",
      evidence_cutoff_at: "2026-08-04T12:00:00Z",
    },
    candidate: {
      query: "operator supplied",
      title: "A dated article about Violeta Sanchez",
      url: "https://news.example/violeta",
      snippet: "Violeta Sanchez is a surfer.",
    },
    capture: {
      timestamp: "20260207045903",
      capturedAt: "2026-02-07T04:59:03Z",
      originalUrl: "https://news.example/violeta",
      statusCode: "200",
      digest: "digest-2",
      mimeType: "text/html",
      archivedUrl: "https://web.archive.org/example-2",
    },
    html: `<html><head><title>A dated article about Violeta Sanchez</title><script type="application/ld+json">${JSON.stringify({
      "@type": "NewsArticle",
      datePublished: "2024-01-22T17:29:44Z",
      dateModified: "2024-01-22T17:30:26Z",
      headline: "A dated article about Violeta Sanchez",
    })}</script></head><body>La surfista Violeta Sánchez, una joven de (entonces) 22 años, vivía en España.</body></html>`,
  });
  const staticNewsAge = staticNewsBody.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(staticNewsAge?.effectiveAt, "2024-01-22T17:29:44.000Z");
});

test("official commission tables resolve DOB only from a dated exact-athlete regulator row", () => {
  const california = extractOfficialCommissionAdultEvidence({
    athleteName: "Crystal Pittman",
    sport: "Combat Sports",
    sourceUrl: "https://www.dca.ca.gov/csac/meetings/materials/20240610_materials.pdf",
    publishedAt: "2024-06-10",
    evidenceCutoffAt: "2026-07-30T12:00:00Z",
    sourceText: [
      "04/27/24 Bare Knuckle Fighting Championship",
      "BOUT RND ATHLETE WT LIC FED ID# EXP DATE DOB REC PURSE",
      "Crystal Pittman 135.0 APP CA1028229 08/14/25 08/06/86 4-1 $500",
    ].join("\n"),
  });
  assert.equal(california?.birthDate, "1986-08-06");
  const florida = extractOfficialCommissionAdultEvidence({
    athleteName: "Crystal Pittman",
    sport: "Combat Sports",
    sourceUrl: "https://www2.myfloridalicense.com/pro/sbc/documents/05-02-25-BKFC_Promotions-Results_without_med.pdf",
    publishedAt: "2025-05-02",
    evidenceCutoffAt: "2026-07-30T12:00:00Z",
    sourceText: [
      "Bout Corner Sport Participant Name Hometown DOB Federal ID",
      "Blue Bare Knuckle Crystal Pittman Visalia, CA 08/06/1986 CA-1028229 135.6",
    ].join("\n"),
  });
  assert.equal(florida?.birthDate, "1986-08-06");
  const proDebutWithoutFederalId = extractOfficialCommissionAdultEvidence({
    athleteName: "Daryn Harris",
    sport: "Boxing",
    sourceUrl: "https://www2.myfloridalicense.com/pro/sbc/documents/1-23-26-Brand_Risk_Promotions-Results_without_med.pdf",
    publishedAt: "2026-01-23",
    evidenceCutoffAt: "2026-05-11T12:00:00Z",
    sourceText: [
      "Bout Corner Sport Participant Name Hometown DOB Federal ID Weight Result",
      "Pro",
      "Blue Boxing Daryn Harris Miami, FL 11/24/1999 Debut 119.4 Win",
    ].join("\n"),
  });
  assert.equal(proDebutWithoutFederalId?.birthDate, "1999-11-24");
  const proDebutSplitAfterAthlete = extractOfficialCommissionAdultEvidence({
    athleteName: "Daryn Harris",
    sport: "Boxing",
    sourceUrl: "https://www2.myfloridalicense.com/pro/sbc/documents/1-23-26-Brand_Risk_Promotions-Results_without_med.pdf",
    publishedAt: "2026-01-23",
    evidenceCutoffAt: "2026-05-11T12:00:00Z",
    sourceText: [
      "MATCH RESULTS Event Date: 1/23/2026 Event Type: Boxing",
      "FLORIDA ATHLETIC COMMISSION",
      "Bout Corner Sport Participant Name Hometown DOB Weight",
      "Blue Daryn Harris Miami, FL 11/24/1999",
      "Pro",
      "Debut 119.4 Win",
    ].join("\n"),
  });
  assert.equal(proDebutSplitAfterAthlete?.birthDate, "1999-11-24");
  assert.match(proDebutSplitAfterAthlete?.excerpt || "", /Daryn Harris[\s\S]*Pro[\s\S]*Debut/);
  assert.equal(extractOfficialCommissionAdultEvidence({
    athleteName: "Daryn Harris",
    sport: "Boxing",
    sourceUrl: "https://www2.myfloridalicense.com/pro/sbc/documents/1-23-26-Brand_Risk_Promotions-Results_without_med.pdf",
    publishedAt: "2026-01-23",
    evidenceCutoffAt: "2026-05-11T12:00:00Z",
    sourceText: proDebutSplitAfterAthlete?.excerpt || "",
  })?.birthDate, "1999-11-24");
  assert.equal(extractOfficialCommissionAdultEvidence({
    athleteName: "Crystal Pittman",
    sport: "Combat Sports",
    sourceUrl: "https://example.com/20240610_materials.pdf",
    publishedAt: "2024-06-10",
    evidenceCutoffAt: "2026-07-30T12:00:00Z",
    sourceText: california?.excerpt || "",
  }), null);
});

test("official WorldWCR entry lists resolve a DOB only from an exact dated rider row", () => {
  const sourceText = [
    "1.1 WorldWCR 107/05",
    "Acerbis Italian Round, 20-22 September 2024",
    "Biographical Entry List Cremona Circuit 3.768 m",
    "No. Rider (Abbreviation) Nat Bike Wins Podiums Pole Races Tyres",
    "Age Date of Birth Place of Birth Team 2024 2024 2024 2024",
    "17 46 RUIZ Pakita (Rui) ESP Yamaha YZF-R7 6 Pirelli",
    "27 11/08/1997 Palma de Mallorca PS Racing Team 46+1 6",
  ].join("\n");
  const evidence = extractOfficialCompetitionEntryAdultEvidence({
    athleteName: "Pakita Ruiz",
    sport: "Motorcycle Road Racing",
    sourceUrl: "https://resources.worldsbk.com/files/results/2024/CRE/WCR/L1A/RID/Entry.pdf?version=abc",
    sourceText,
    publishedAt: "2024-09-20",
    evidenceCutoffAt: "2026-02-11T12:00:00Z",
  });
  assert.equal(evidence?.birthDate, "1997-08-11");
  const broadHistoricalSport = extractOfficialCompetitionEntryAdultEvidence({
    athleteName: "Maria Herrera",
    sport: "Motorsports",
    sourceUrl: "https://resources.worldsbk.com/files/results/2025/JER/WCR/L1A/RID/Entry.pdf?version=abc",
    sourceText: sourceText.replace("RUIZ Pakita", "HERRERA Maria").replace("27 11/08/1997", "29 26/08/1996"),
    publishedAt: "2025-10-17",
    evidenceCutoffAt: "2025-12-10T12:00:00Z",
  });
  assert.equal(broadHistoricalSport?.birthDate, "1996-08-26");
  assert.equal(extractOfficialCompetitionEntryAdultEvidence({
    athleteName: "Different Rider",
    sport: "Motorcycle Road Racing",
    sourceUrl: "https://resources.worldsbk.com/files/results/2024/CRE/WCR/L1A/RID/Entry.pdf?version=abc",
    sourceText,
    publishedAt: "2024-09-20",
    evidenceCutoffAt: "2026-02-11T12:00:00Z",
  }), null);
  assert.equal(extractOfficialCompetitionEntryAdultEvidence({
    athleteName: "Pakita Ruiz",
    sport: "Motorcycle Road Racing",
    sourceUrl: "https://untrusted.example/results/2024/CRE/WCR/L1A/RID/Entry.pdf",
    sourceText,
    publishedAt: "2024-09-20",
    evidenceCutoffAt: "2026-02-11T12:00:00Z",
  }), null);
});

test("official ISU structured profiles are cutoff-safe only when their own update predates the decision", () => {
  const record = {
    id: "alex",
    athlete_name: "Alex Ianculescu",
    sport: "Speed skating",
    fit_label: "fit" as const,
    evidence_cutoff_at: "2026-02-11T12:00:00Z",
  };
  assert.equal(
    buildOfficialDatedProfileCandidates(record)[1]?.url,
    "https://isu-skating.com/speed-skating/skaters/alexandra-ianculescu/"
  );
  const sourceText = `self.__next_f.push([1,"{\\"skaters_id\\":2808,\\"full_name\\":\\"Alexandra Ianculescu\\",\\"date_of_birth\\":\\"21 Oct 1991\\",\\"status\\":\\"Active\\",\\"created_at\\":\\"2024-10-03T07:19:36.000Z\\",\\"updated_at\\":\\"2025-06-18T06:11:04.000Z\\",\\"nick_names\\":\\"Alex (Twitter profile, 28 Nov 2016)\\",\\"discipline\\":{\\"title\\":\\"SPEED SKATING\\"}}"]);`;
  const evidence = extractOfficialDatedProfileEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: buildOfficialDatedProfileCandidates(record)[1]!.url,
    sourceText,
    evidenceCutoffAt: record.evidence_cutoff_at,
  });
  assert.equal(evidence?.birthDate, "1991-10-21");
  assert.equal(evidence?.publishedAt, "2025-06-18T06:11:04.000Z");
  assert.match(evidence?.excerpt || "", /Official profile record 2808/);
  assert.match(evidence?.excerpt || "", /Official profile nicknames: Alex/);

  assert.equal(extractOfficialDatedProfileEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: buildOfficialDatedProfileCandidates(record)[1]!.url,
    sourceText: sourceText.replace("2025-06-18T06:11:04.000Z", "2026-06-18T06:11:04.000Z"),
    evidenceCutoffAt: record.evidence_cutoff_at,
  }), null);
  assert.equal(extractOfficialDatedProfileEvidence({
    athleteName: "Different Athlete",
    sport: record.sport,
    sourceUrl: buildOfficialDatedProfileCandidates(record)[1]!.url,
    sourceText,
    evidenceCutoffAt: record.evidence_cutoff_at,
  }), null);
  assert.equal(extractOfficialDatedProfileEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: buildOfficialDatedProfileCandidates(record)[1]!.url,
    sourceText: sourceText.replace(/,\\"nick_names\\":\\"[^\"]+\\"/, ""),
    evidenceCutoffAt: record.evidence_cutoff_at,
  }), null);
});

test("evaluation profiles default to a genuinely bounded smoke budget", () => {
  assert.equal(normalizeResearchEvaluationProfile(undefined), "smoke");
  assert.equal(normalizeResearchEvaluationProfile("unexpected"), "smoke");
  assert.equal(normalizeResearchEvaluationProfile("release"), "release");

  const smoke = getResearchEvaluationBudget("smoke");
  assert.deepEqual(smoke, {
    profile: "smoke",
    resultCount: 3,
    depth: "standard",
    maxDiscoveryWaves: 1,
    discoveryCandidatesPerWave: 8,
    enrichmentPoolLimit: 6,
    maxResearcherInputTokens: 40_000,
    maxResearcherOutputTokens: 12_000,
    maxAuditCandidates: 3,
  });
  assert.ok(smoke.enrichmentPoolLimit < getResearchEvaluationBudget("development").enrichmentPoolLimit);
});

test("paid enrichment gives fresh discovery priority without discarding memory", () => {
  const selected = selectBalancedResearchCandidates([
    ...Array.from({ length: 8 }, (_, index) => ({ id: `memory-${index}`, discovery_lane: "memory" as const })),
    ...Array.from({ length: 8 }, (_, index) => ({ id: `fresh-${index}`, discovery_lane: "fresh" as const })),
  ], 6);

  assert.deepEqual(selected.map((candidate) => candidate.id), [
    "fresh-0", "fresh-1", "fresh-2", "fresh-3", "memory-0", "memory-1",
  ]);
});

const HISTORICAL_CASE: HistoricalBenchmarkRecord = {
  athleteName: "Example Athlete",
  decisionDate: "2026-05-03",
  fitAtTime: "Strong Fit",
  outcome: "Stalled",
  primaryReason: "terms/rights",
  explanation: "The athlete was approved, but contract scope remained unresolved.",
  evidenceRef: "E70",
  confidence: "Medium",
  emailSubjects: "Approval / contract follow-up",
  relevantDates: "2026-05-03; 2026-08-04",
  evidenceEstablishes: "Approval; no final execution located.",
  evidenceNotes: "Draft contract available.",
};

test("strict golden records require leakage-safe point-in-time labels", () => {
  assert.throws(() => parseGoldenRecordInput({
    athleteName: "Example Athlete",
    sport: "volleyball",
    fitLabel: "fit",
    achievabilityLabel: "high",
    finalOutcome: "signed",
    primaryReason: "fit",
    pursueToday: "yes",
    pointInTimeReliability: "strong",
    benchmarkSplit: "held_out",
  }), /decision date.*evidence cutoff.*public-knowability.*fit assessment locked.*label completion time/);

  const record = parseGoldenRecordInput({
    athleteName: "Example Athlete",
    sport: "volleyball",
    decisionAt: "2025-06-15T12:00:00Z",
    evidenceCutoffAt: "2025-06-14T12:00:00Z",
    fitLabel: "fit",
    achievabilityLabel: "high",
    finalOutcome: "signed",
    primaryReason: "fit",
    decisiveInformationPubliclyKnowable: true,
    pursueToday: "yes",
    labelOrderFitBeforeOutcome: true,
    pointInTimeReliability: "strong",
    benchmarkSplit: "held_out",
    labeledAt: "2026-08-07T12:00:00Z",
  });
  assert.equal(record.benchmarkSplit, "held_out");
  assert.equal(record.fitLabel, "fit");
});

test("golden record parsing prevents evidence from after the original decision", () => {
  assert.throws(() => parseGoldenRecordInput({
    athleteName: "Example Athlete",
    sport: "surfing",
    decisionAt: "2025-06-15T12:00:00Z",
    evidenceCutoffAt: "2025-06-16T12:00:00Z",
  }), /Evidence cutoff cannot be after/);
});

test("historical mailbox outcomes are the authoritative commercial ground truth", () => {
  const prepared = prepareHistoricalBenchmarkRecord(HISTORICAL_CASE);
  assert.equal(prepared.golden.fitLabel, "not_fit");
  assert.equal(prepared.golden.achievabilityLabel, "low");
  assert.equal(prepared.golden.finalOutcome, "stalled");
  assert.equal(prepared.golden.benchmarkSplit, "excluded");
  assert.equal(prepared.golden.evidenceCutoffAt, prepared.golden.decisionAt);
  assert.equal(prepared.golden.pursueToday, "no");
  assert.equal(prepared.outcomeCensored, false);
  assert.equal(prepared.evidencePhase, "mixed");
  assert.equal(prepared.evidence.eligibleBeforeCutoff, false);
  assert.ok(prepared.golden.stratificationTags.includes("dylan_outcome_ground_truth"));
  assert.ok(prepared.golden.stratificationTags.includes("commercial_negative"));
  assert.ok(prepared.golden.stratificationTags.includes("post_decision_evidence_present"));
});

test("raw fit descriptions never override Dylan's outcome label", () => {
  const prepared = prepareHistoricalBenchmarkRecord({
    ...HISTORICAL_CASE,
    fitAtTime: "Possible Fit",
    outcome: "Rejected",
    evidenceRef: "E02",
  });
  assert.equal(prepared.golden.fitLabel, "not_fit");
  assert.equal(prepared.golden.achievabilityLabel, "low");
  assert.ok(prepared.golden.stratificationTags.includes("raw_fit_possible_fit"));
});

test("historical outcome mapping produces 44 positive and 56 negative source labels", () => {
  assert.deepEqual(historicalOutcomeGroundTruth("Signed"), {
    fitLabel: "fit", achievabilityLabel: "high", pursueToday: "yes", groundTruthClass: "positive",
  });
  assert.deepEqual(historicalOutcomeGroundTruth("Approved but Did Not Sign"), {
    fitLabel: "fit", achievabilityLabel: "high", pursueToday: "yes", groundTruthClass: "positive",
  });
  assert.equal(historicalOutcomeGroundTruth("Rejected").fitLabel, "not_fit");
  assert.equal(historicalOutcomeGroundTruth("Stalled").fitLabel, "not_fit");
});

test("historical reconciliation makes Dylan's workbook authoritative", () => {
  const prepared = prepareHistoricalBenchmarkRecord({
    ...HISTORICAL_CASE,
    athleteName: "Furkan Areion (Calioglu)",
    outcome: "Approved but Did Not Sign",
    evidenceRef: "E10",
  });
  const reconciled = reconcileHistoricalGoldenRecord(prepared, {
    id: "existing",
    athlete_name: "Furkan Areion",
    athlete_id: null,
    sport: "Motorcycle Racing",
    fit_label: "fit",
    final_outcome: "signed",
    internal_record_reference: "dylan_message:2026-08-10#furkan-areion",
    stratification_tags: ["commercial_positive", "signed", "dylan_2026_08_10"],
  });
  assert.equal(historicalBenchmarkNamesMatch("Furkan Areion", "Furkan Areion (Calioglu)"), true);
  assert.equal(reconciled.conflict, false);
  assert.equal(reconciled.golden.finalOutcome, "non_signing");
  assert.equal(reconciled.golden.fitLabel, "fit");
  assert.equal(reconciled.golden.sport, "Motorcycle Racing");
  assert.equal(reconciled.golden.stratificationTags.includes("historical_label_conflict"), false);
  assert.equal(reconciled.golden.stratificationTags.includes("needs_sport_enrichment"), false);

  const idempotent = reconcileHistoricalGoldenRecord(prepared, {
    id: "existing",
    athlete_name: "Furkan Areion (Calioglu)",
    athlete_id: null,
    sport: "Motorcycle Racing",
    fit_label: "uncertain",
    final_outcome: "non_signing",
    internal_record_reference: reconciled.golden.internalRecordReference,
    stratification_tags: reconciled.golden.stratificationTags,
  });
  assert.equal(idempotent.conflict, false);
  assert.equal(idempotent.golden.finalOutcome, "non_signing");

  const sourceBackedSport = prepareHistoricalBenchmarkRecord({
    ...HISTORICAL_CASE,
    evidenceRef: "E11",
    evidenceDetails: [{
      claimCategory: "Sport",
      extractedValue: "Snowboarding",
      sourceDate: "2026-04-20",
      sourceEmailSubject: "Athlete proposal",
      sourceDocumentReference: "proposal.pdf",
      supportingExcerpt: "The athlete competes in snowboarding.",
      beforeDecisionCutoff: "Yes",
      identityMatchConfidence: "High",
    }],
  });
  assert.equal(reconcileHistoricalGoldenRecord(sourceBackedSport, {
    id: "generic",
    athlete_name: HISTORICAL_CASE.athleteName,
    sport: "Motorsports",
    fit_label: "fit",
    final_outcome: "signed",
  }).golden.sport, "Snowboarding");
});

test("historical social snapshots require dated pre-decision provenance", () => {
  const snapshot = prepareHistoricalSocialSnapshot({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    snapshot: {
      sport: "Beach Volleyball",
      instagramHandle: "@example.athlete",
      instagramFollowerCount: "~122K",
      instagramEngagementRatePercent: "3.1%",
      averageEngagement: "3.8K",
      creatorActivity: "Posted weekly training videos and tournament vlogs.",
      sourceDate: "2026-04-20",
      sourceEmailSubject: "Example Athlete partnership proposal",
      sourceDocumentReference: "Example Athlete media kit.pdf",
    },
  });
  assert.equal(snapshot?.instagramHandle, "example.athlete");
  assert.equal(snapshot?.instagramFollowerCount, 122_000);
  assert.equal(snapshot?.instagramFollowerCountApproximate, true);
  assert.equal(snapshot?.instagramEngagementRatePercent, 3.1);
  assert.equal(snapshot?.averageEngagement, 3_800);
  assert.deepEqual(snapshot?.claims.map((claim) => claim.claimType), [
    "athlete_profile", "audience_signal", "social_engagement_signal", "creator_behavior_signal",
  ]);

  assert.throws(() => prepareHistoricalSocialSnapshot({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    snapshot: {
      instagramHandle: "example.athlete",
      instagramFollowerCount: 122_000,
      sourceDate: "2026-05-04",
      sourceEmailSubject: "Future snapshot",
      sourceDocumentReference: "future.pdf",
    },
  }), /after the decision date/);
  assert.throws(() => prepareHistoricalSocialSnapshot({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    snapshot: {
      instagramFollowerCount: 122_000,
      sourceDate: "2026-04-20",
      sourceEmailSubject: "Missing identity",
      sourceDocumentReference: "snapshot.pdf",
    },
  }), /metrics require the Instagram handle/);
});

test("existing Apify Instagram history becomes evidence only for exact pre-cutoff handles", () => {
  const snapshot = prepareHistoricalInstagramSnapshot({
    athleteName: "Example Athlete",
    sport: "Beach volleyball",
    expectedHandle: "@example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z",
    capturedAt: "2026-04-20T10:00:00.000Z",
    profile: {
      username: "example.athlete",
      followersCount: 120_000,
      followsCount: 400,
      postsCount: 240,
      latestPosts: [
        { likesCount: 4_000, commentsCount: 100, timestamp: "2026-04-18T10:00:00.000Z" },
        { likesCount: 2_000, commentsCount: 50, timestamp: "2026-04-10T10:00:00.000Z" },
      ],
    },
  });
  assert.equal(snapshot?.followers, 120_000);
  assert.deepEqual(snapshot?.claims.map((claim) => claim.claimType), [
    "athlete_profile", "audience_signal", "social_engagement_signal", "creator_behavior_signal",
  ]);
  assert.equal(snapshot?.claims[2].structuredValue.engagement_rate_percent, 2.5625);
  assert.equal(prepareHistoricalInstagramSnapshot({
    athleteName: "Example Athlete", sport: "Beach volleyball", expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z", capturedAt: "2026-05-04T10:00:00.000Z",
    profile: { username: "example.athlete", followersCount: 120_000 },
  }), null);
  assert.equal(prepareHistoricalInstagramSnapshot({
    athleteName: "Example Athlete", sport: "Beach volleyball", expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z", capturedAt: "2026-04-20T10:00:00.000Z",
    profile: { username: "different.person", followersCount: 120_000 },
  }), null);
});

test("Social Blade recovery uses the cheapest sufficient tier and only exact, recent pre-cutoff rows", () => {
  assert.deepEqual(inspectSocialBladeCredentials({ clientId: undefined, token: undefined }), {
    clientIdVariablePresent: false,
    clientIdHasValue: false,
    tokenVariablePresent: false,
    tokenHasValue: false,
    valuesDistinct: true,
    maskedPlaceholderDetected: false,
    usable: false,
    validationError: "Social Blade client ID is missing",
  });
  assert.equal(inspectSocialBladeCredentials({ clientId: "•••••••••••", token: "•••••••••••" }).usable, false);
  assert.equal(inspectSocialBladeCredentials({ clientId: "same-value", token: "same-value" }).usable, false);
  assert.equal(inspectSocialBladeCredentials({ clientId: "actual-client-id", token: "actual-token" }).usable, true);

  const now = new Date("2026-08-13T12:00:00.000Z");
  assert.deepEqual(socialBladeHistoryTierForCutoff("2026-08-03T12:00:00.000Z", now), {
    tier: "default", credits: 1, ageDays: 10,
  });
  assert.deepEqual(socialBladeHistoryTierForCutoff("2025-10-07T12:00:00.000Z", now), {
    tier: "extended", credits: 2, ageDays: 310,
  });

  const snapshot = prepareSocialBladeInstagramSnapshot({
    expectedHandle: "@example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z",
    response: {
      status: { success: true, status: 200 },
      data: {
        id: { username: "example.athlete", display_name: "Example Athlete" },
        statistics: {
          total: { followers: 130_000, following: 410, media: 250, engagement_rate: 2.4 },
          daily: [
            { date: "2026-05-04T00:00:00.000Z", followers: 999_999, media: 999, avg_likes: 99_999, avg_comments: 999 },
            { date: "2026-05-03T00:00:00.000Z", followers: 120_000, following: 400, media: 240, avg_likes: 3_000, avg_comments: 75 },
            { date: "2026-05-02T00:00:00.000Z", followers: 119_500, media: 239, avg_likes: 2_900, avg_comments: 70 },
          ],
        },
      },
    },
  });
  assert.equal(snapshot?.capturedAt, "2026-05-03T00:00:00.000Z");
  assert.equal(snapshot?.followers, 120_000);
  assert.deepEqual(snapshot?.claims.map((claim) => claim.claimType), [
    "audience_signal", "social_engagement_signal", "creator_behavior_signal",
  ]);
  assert.equal(snapshot?.claims[1].structuredValue.engagement_rate_percent, 2.5625);
  assert.ok(snapshot?.claims.every((claim) => !claim.claimText.includes("Beach volleyball")));

  assert.equal(prepareSocialBladeInstagramSnapshot({
    expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z",
    response: {
      status: { success: true },
      data: { id: { username: "different.person" }, daily: [{ date: "2026-05-03T00:00:00.000Z", followers: 120_000 }] },
    },
  }), null);
  assert.equal(prepareSocialBladeInstagramSnapshot({
    expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z",
    response: {
      status: { success: true },
      data: { id: { username: "example.athlete" }, daily: [{ date: "2026-03-01T00:00:00.000Z", followers: 120_000 }] },
    },
  }), null);
  const widerWindowSnapshot = prepareSocialBladeInstagramSnapshot({
    expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z",
    maximumSnapshotAgeDays: 90,
    response: {
      status: { success: true },
      data: { id: { username: "example.athlete" }, daily: [{ date: "2026-03-01T00:00:00.000Z", followers: 120_000, media: 220 }] },
    },
  });
  assert.equal(widerWindowSnapshot?.snapshotAgeDays, 63);
  assert.equal(widerWindowSnapshot?.followers, 120_000);
});

test("Social Blade failure diagnostics separate wrong handles from stale cutoff history", () => {
  const diagnostics = diagnoseSocialBladeInstagramResponse({
    expectedHandle: "@example.athlete",
    evidenceCutoffAt: "2026-05-03T12:00:00.000Z",
    response: {
      status: { success: true, status: 200 },
      info: { credits: { available: 71 } },
      data: {
        id: { username: "different.person", display_name: "Different Person" },
        statistics: {
          daily: [
            { date: "invalid-date", followers: 100 },
            { date: "2026-03-01T00:00:00.000Z", followers: 120_000 },
            { date: "2026-05-04T00:00:00.000Z", followers: 121_000 },
          ],
        },
      },
    },
  });
  assert.deepEqual(diagnostics, {
    expectedHandle: "example.athlete",
    returnedHandle: "different.person",
    returnedDisplayName: "Different Person",
    exactHandleMatch: false,
    providerSuccess: true,
    providerStatus: 200,
    providerError: null,
    dailyRowCount: 3,
    validDatedRowCount: 2,
    preCutoffRowCount: 1,
    earliestDailyAt: "2026-03-01T00:00:00.000Z",
    latestDailyAt: "2026-05-04T00:00:00.000Z",
    latestPreCutoffAt: "2026-03-01T00:00:00.000Z",
    latestPreCutoffAgeDays: 63,
  });
  assert.equal("credits" in diagnostics, false, "credit/account data must not leak into diagnostics");
});

test("Apify public Social Blade recovery requires an exact dated daily row and never backdates a current profile", () => {
  const snapshot = prepareApifyPublicSocialBladeInstagramSnapshot({
    expectedHandle: "@example.athlete",
    evidenceCutoffAt: "2026-08-05T23:59:59.000Z",
    rows: [
      {
        recordType: "profile", platform: "instagram", username: "example.athlete",
        followers: 130_000, uploads: 250, scrapedAt: "2026-08-13T12:00:00.000Z",
        url: "https://socialblade.com/instagram/user/example.athlete",
      },
      { recordType: "dailyStat", platform: "instagram", username: "example.athlete", date: "2026-08-06", followers: 125_000, uploads: 245 },
      { recordType: "dailyStat", platform: "instagram", username: "example.athlete", date: "2026-08-05", followers: 124_000, following: 400, uploads: 244 },
      { recordType: "dailyStat", platform: "instagram", username: "different.person", date: "2026-08-05", followers: 999_999, uploads: 999 },
    ],
  });
  assert.equal(snapshot?.capturedAt, "2026-08-05T00:00:00.000Z");
  assert.equal(snapshot?.followers, 124_000);
  assert.equal(snapshot?.media, 244);
  assert.deepEqual(snapshot?.claims.map((claim) => claim.claimType), [
    "audience_signal", "creator_behavior_signal",
  ]);

  assert.equal(prepareApifyPublicSocialBladeInstagramSnapshot({
    expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-08-05T23:59:59.000Z",
    rows: [{
      recordType: "profile", platform: "instagram", username: "example.athlete",
      followers: 130_000, uploads: 250, scrapedAt: "2026-08-13T12:00:00.000Z",
    }],
  }), null, "a current profile row is not historical evidence");
  assert.equal(prepareApifyPublicSocialBladeInstagramSnapshot({
    expectedHandle: "example.athlete",
    evidenceCutoffAt: "2026-08-05T23:59:59.000Z",
    rows: [{
      recordType: "dailyStat", platform: "instagram", username: "different.person",
      date: "2026-08-05", followers: 130_000,
    }],
  }), null, "a different handle cannot be substituted");
});

test("historical workbook conversion locks Dylan's truth and preserves row-level provenance", () => {
  const benchmarkHeaders = [
    "Athlete / Talent", "Approx. decision date", "OnlyFans fit at the time", "Outcome",
    "Primary reason", "One-sentence explanation", "Evidence ref", "Confidence",
  ];
  const evidenceHeaders = [
    "Evidence ref", "Athlete / Talent", "Email subject(s)", "Relevant date(s)",
    "What the evidence establishes", "Notes / documents available",
  ];
  const detailHeaders = [
    "Athlete Name", "Claim Category", "Extracted Value", "Source Date", "Email Subject",
    "Attachment Filename or Document Reference", "Supporting Excerpt",
    "Before Decision Cutoff — Yes/No", "Identity Match Confidence — High/Medium/Low", "Notes",
  ];
  const outcomes = [
    ...Array(41).fill("Signed"),
    ...Array(3).fill("Approved but Did Not Sign"),
    ...Array(23).fill("Rejected"),
    ...Array(33).fill("Stalled"),
  ];
  const benchmarkRows = outcomes.map((outcome, index) => [
    `Athlete ${index + 1}`, "2026-05-03", "Uncertain", outcome, "internal decision",
    `Locked explanation ${index + 1}`, `E${String(index + 1).padStart(2, "0")}`, "High",
  ]);
  const evidenceRows = outcomes.map((_, index) => [
    `E${String(index + 1).padStart(2, "0")}`, `Athlete ${index + 1}`, `Subject ${index + 1}`,
    "2026-04-20", `Evidence ${index + 1}`, `Document ${index + 1}.pdf`,
  ]);
  const details = outcomes.map((_, index) => [
    `Athlete ${index + 1}`, "Sport", "Volleyball", "2026-04-20", `Subject ${index + 1}`,
    `Document ${index + 1}.pdf`, `Athlete ${index + 1} played volleyball.`, "Yes", "High", "",
  ]);
  const baseline = {
    sheets: {
      Benchmark: [["title"], [], [], benchmarkHeaders, ...benchmarkRows],
      "Evidence Index": [["title"], [], [], evidenceHeaders, ...evidenceRows],
    },
  };
  const enriched = {
    sheets: {
      ...baseline.sheets,
      "Historical Evidence Details": [["title"], [], [], detailHeaders, ...details],
    },
  };
  const converted = convertOnlyFansHistoricalWorkbookExtraction({ enriched, baseline });
  assert.equal(converted.validation.records, 100);
  assert.equal(converted.validation.lockedDifferences, 0);
  assert.equal(converted.validation.evidenceDetailRows, 100);
  assert.equal(converted.validation.evidenceDetailAthletes, 100);
  assert.deepEqual(converted.validation.outcomeCounts, {
    "Approved but Did Not Sign": 3, Rejected: 23, Signed: 41, Stalled: 33,
  });
  const prepared = prepareHistoricalBenchmarkRecord(converted.records[0]);
  assert.equal(prepared.golden.sport, "Volleyball");
  assert.equal(prepared.evidenceDetails[0].claimType, "sport_identity");
  assert.equal(prepared.evidenceDetails[0].sourceDate, "2026-04-20");

  const changed = structuredClone(enriched);
  changed.sheets.Benchmark[4][3] = "Rejected";
  assert.throws(() => convertOnlyFansHistoricalWorkbookExtraction({ enriched: changed, baseline }), /changed 1 locked source cell/);
});

test("historical detail evidence rejects leakage and keeps age as a non-scoring hint", () => {
  const detail = prepareHistoricalEvidenceDetails({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    details: [{
      claimCategory: "Explicit Age or 21+ Evidence",
      extractedValue: "Born in 2000",
      sourceDate: "2026-04-20",
      sourceEmailSubject: "Example proposal",
      sourceDocumentReference: "example.pdf",
      supportingExcerpt: "Example Athlete was born in 2000.",
      beforeDecisionCutoff: "Yes",
      identityMatchConfidence: "High",
    }],
  });
  assert.equal(detail[0].claimType, "adult_eligibility_hint");
  assert.equal(detail[0].eligibleForScoring, false);
  assert.match(detail[0].exclusionReason || "", /two independent public sources/);
  const platformActivity = prepareHistoricalEvidenceDetails({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    details: [{
      claimCategory: "OnlyFans Platform Activity at Decision",
      extractedValue: "Profile inactive and closed to new subscribers",
      sourceDate: "2026-04-20",
      sourceEmailSubject: "Example proposal",
      sourceDocumentReference: "example.pdf",
      supportingExcerpt: "Example Athlete's exact OnlyFans profile was inactive and closed to new subscribers.",
      beforeDecisionCutoff: "Yes",
      identityMatchConfidence: "High",
    }],
  });
  assert.equal(platformActivity[0].claimType, "onlyfans_platform_activity_signal");
  assert.equal(platformActivity[0].eligibleForScoring, true);
  assert.equal(platformActivity[0].material, true);
  const leaked = prepareHistoricalEvidenceDetails({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    details: [{
      claimCategory: "Known Commercial or Economic Information",
      extractedValue: "$60K ask; approved structure discussed at $30K",
      sourceDate: "2026-04-20",
      sourceEmailSubject: "Example proposal",
      sourceDocumentReference: "example.pdf",
      supportingExcerpt: "The approved structure was $30K plus bonus.",
      beforeDecisionCutoff: "Yes",
      identityMatchConfidence: "High",
    }],
  });
  assert.equal(leaked[0].eligibleForScoring, false);
  assert.match(leaked[0].exclusionReason || "", /benchmark leakage/);
  assert.throws(() => prepareHistoricalEvidenceDetails({
    athleteName: "Example Athlete",
    decisionDate: "2026-05-03",
    details: [{
      claimCategory: "Athletic Momentum at Decision",
      extractedValue: "Won the championship",
      sourceDate: "2026-05-04",
      sourceEmailSubject: "Future proposal",
      sourceDocumentReference: "future.pdf",
      supportingExcerpt: "Example Athlete won the championship.",
      beforeDecisionCutoff: "Yes",
      identityMatchConfidence: "High",
    }],
  }), /after the decision date/);
});

test("creator potential gate requires both audience and creator behavior", () => {
  const evidence = [
    {
      sourceId: "audience-source", claimId: "audience-claim", sourceRef: "E1",
      url: "https://instagram.com/example", domain: "instagram.com", title: "Example Athlete social snapshot",
      claimType: "audience_signal", claim: "Example Athlete had 122,000 followers.", excerpt: "",
      effectiveAt: "2026-04-20T12:00:00.000Z", independenceGroup: "instagram.com", material: true,
      structuredValue: { follower_count: 122_000 },
    },
    {
      sourceId: "creator-source", claimId: "creator-claim", sourceRef: "E2",
      url: "https://youtube.com/example", domain: "youtube.com", title: "Example Athlete creator snapshot",
      claimType: "creator_behavior_signal", claim: "Example Athlete posted weekly tournament vlogs.", excerpt: "",
      effectiveAt: "2026-04-20T12:00:00.000Z", independenceGroup: "youtube.com", material: true,
      structuredValue: { creator_activity: "weekly tournament vlogs" },
    },
  ];
  assert.deepEqual(benchmarkCreatorPotentialGate({ id: "case", athlete_name: "Example Athlete", sport: "Volleyball", benchmark_split: "excluded", evidence_cutoff_at: "2026-05-03T12:00:00.000Z" }, evidence), {
    passed: true,
    audienceEvidenceCount: 1,
    creatorEvidenceCount: 1,
  });
  assert.equal(benchmarkCreatorPotentialGate({ id: "case", athlete_name: "Example Athlete", sport: "Volleyball", benchmark_split: "excluded", evidence_cutoff_at: "2026-05-03T12:00:00.000Z" }, evidence.slice(0, 1)).passed, false);
  const contaminatedCandidateEvidence = [{
    ...evidence[0],
    claimType: "candidate_evidence",
    title: "Example Athlete profile",
    claim: "Example Athlete is a volleyball player.",
    excerpt: "Teammate Riley Roe has 200,000 followers and posts weekly videos.",
  }];
  assert.deepEqual(
    benchmarkCreatorPotentialGate({ id: "case", athlete_name: "Example Athlete", sport: "Volleyball", benchmark_split: "excluded", evidence_cutoff_at: "2026-05-03T12:00:00.000Z" }, contaminatedCandidateEvidence),
    { passed: false, audienceEvidenceCount: 0, creatorEvidenceCount: 0 }
  );
});

test("stratified sampling rotates through sports before taking deeper rows", () => {
  const items = [
    { id: 1, sport: "volleyball" },
    { id: 2, sport: "volleyball" },
    { id: 3, sport: "volleyball" },
    { id: 4, sport: "surfing" },
    { id: 5, sport: "surfing" },
    { id: 6, sport: "mma" },
  ];
  assert.deepEqual(
    stratifiedSample(items, 5, (item) => item.sport).map((item) => item.id),
    [6, 4, 1, 5, 2]
  );
});

test("golden athlete keys deduplicate punctuation and accents without crossing sports", () => {
  assert.equal(
    goldenAthleteKey("Asjia O’Neal", "Beach Volleyball"),
    goldenAthleteKey("Asjia O'Neal", "beach-volleyball")
  );
  assert.notEqual(goldenAthleteKey("Jordan Lee", "surfing"), goldenAthleteKey("Jordan Lee", "volleyball"));
});

test("blind golden-record labeling hides outcomes until fit is locked", () => {
  const hidden = maskGoldenRecordForBlindLabeling({
    id: "golden-1",
    athlete_name: "Example Athlete",
    sport: "volleyball",
    fit_label: "fit",
    achievability_label: "uncertain",
    final_outcome: "onlyfans_rejected",
    primary_reason: "fit",
    explanation: "Private outcome detail",
    internal_record_reference: "gmail:secret",
    label_order_fit_before_outcome: false,
    benchmark_split: "excluded",
    stratification_tags: ["historical_label_conflict", "outcome_rejected", "label_confidence_high"],
  });
  assert.equal(hidden.outcome_masked, true);
  assert.equal(hidden.final_outcome, null);
  assert.equal(hidden.primary_reason, null);
  assert.equal(hidden.internal_record_reference, null);
  assert.equal(hidden.label_conflict, true);
  assert.deepEqual(hidden.stratification_tags, ["label_confidence_high"]);

  const visible = maskGoldenRecordForBlindLabeling({
    ...hidden,
    final_outcome: "onlyfans_rejected",
    label_order_fit_before_outcome: true,
  });
  assert.equal(visible.outcome_masked, false);
  assert.equal(visible.final_outcome, "onlyfans_rejected");

  const lockedHeldOut = maskGoldenRecordForBlindLabeling({
    ...visible,
    fit_label: "fit",
    achievability_label: "high",
    pursue_today: "yes",
    benchmark_split: "held_out",
    held_out_locked_at: "2026-08-12T12:00:00.000Z",
    held_out_revealed_at: null,
    stratification_tags: ["dylan_outcome_ground_truth", "outcome_signed", "volleyball"],
  });
  assert.equal(lockedHeldOut.outcome_masked, true);
  assert.equal(lockedHeldOut.fit_label, "uncertain");
  assert.equal(lockedHeldOut.achievability_label, "uncertain");
  assert.equal(lockedHeldOut.final_outcome, null);
  assert.deepEqual(lockedHeldOut.stratification_tags, ["volleyball"]);
});

test("benchmark splits are deterministic, balanced, and never hold out development-only cases", () => {
  const records = ["fit", "not_fit"].flatMap((fitLabel) =>
    Array.from({ length: 40 }, (_, index) => ({
      id: `${fitLabel}-${index}`,
      fit_label: fitLabel as "fit" | "not_fit",
      sport: ["volleyball", "surfing", "mma", "motocross"][index % 4],
      final_outcome: index % 2 ? "signed" : "non_signing",
      stratification_tags: index < 10 ? ["development_only"] : [],
    }))
  );
  const first = assignGoldenRecordSplits(records, "cohort-v1");
  const second = assignGoldenRecordSplits(records, "cohort-v1");
  assert.deepEqual(first, second);
  assert.equal(first.filter((item) => item.split === "held_out" && item.id.startsWith("fit-")).length, 8);
  assert.equal(first.filter((item) => item.split === "held_out" && item.id.startsWith("not_fit-")).length, 8);
  assert.equal(first.filter((item) => item.split === "held_out" && Number(item.id.split("-").at(-1)) < 10).length, 0);
});

test("active benchmark cohort ignores revealed archives and fails closed on conflicts", () => {
  const selection = selectActiveBenchmarkCohort([
    {
      benchmark_split: "held_out",
      benchmark_cohort_version: "archive-v1",
      split_assigned_at: "2026-08-01T00:00:00.000Z",
      held_out_locked_at: "2026-08-01T00:00:00.000Z",
      held_out_revealed_at: "2026-08-02T00:00:00.000Z",
    },
    {
      benchmark_split: "held_out",
      benchmark_cohort_version: "active-v2",
      split_assigned_at: "2026-08-12T00:00:00.000Z",
      held_out_locked_at: "2026-08-12T00:00:00.000Z",
      held_out_revealed_at: null,
    },
    {
      benchmark_split: "development",
      benchmark_cohort_version: "unrelated-development",
      split_assigned_at: "2026-08-13T00:00:00.000Z",
      held_out_locked_at: null,
      held_out_revealed_at: null,
    },
  ]);
  assert.deepEqual(selection, {
    cohortVersion: "active-v2",
    conflict: false,
    activeVersions: ["active-v2"],
  });

  const conflict = selectActiveBenchmarkCohort([
    {
      benchmark_split: "held_out",
      benchmark_cohort_version: "active-v2",
      split_assigned_at: "2026-08-12T00:00:00.000Z",
      held_out_locked_at: "2026-08-12T00:00:00.000Z",
      held_out_revealed_at: null,
    },
    {
      benchmark_split: "held_out",
      benchmark_cohort_version: "active-v3",
      split_assigned_at: "2026-08-13T00:00:00.000Z",
      held_out_locked_at: "2026-08-13T00:00:00.000Z",
      held_out_revealed_at: null,
    },
  ]);
  assert.equal(conflict.cohortVersion, null);
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.activeVersions, ["active-v3", "active-v2"]);
});

test("a minimum viable balanced cohort locks eight cases per label", () => {
  const records = ["fit", "not_fit"].flatMap((fitLabel) =>
    Array.from({ length: 16 }, (_, index) => ({
      id: `${fitLabel}-minimum-${index}`,
      fit_label: fitLabel as "fit" | "not_fit",
      sport: ["surfing", "tennis", "bmx", "boxing"][index % 4],
      final_outcome: index % 2 ? "signed" : "stalled",
      stratification_tags: [],
    }))
  );
  const assignments = assignGoldenRecordSplits(records, "minimum-cohort-v1");
  assert.equal(assignments.filter((item) => item.split === "held_out" && item.id.startsWith("fit-")).length, 8);
  assert.equal(assignments.filter((item) => item.split === "held_out" && item.id.startsWith("not_fit-")).length, 8);
});

test("challenge holdout locks eight untouched cases per label without creating development cases", () => {
  const records = [
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `fit-${index}`,
      fit_label: "fit" as const,
      sport: index % 2 ? "Surfing" : "Volleyball",
      final_outcome: "signed",
      stratification_tags: [] as string[],
    })),
    ...Array.from({ length: 11 }, (_, index) => ({
      id: `not-fit-${index}`,
      fit_label: "not_fit" as const,
      sport: index % 2 ? "Boxing" : "Tennis",
      final_outcome: "stalled",
      stratification_tags: [] as string[],
    })),
  ];
  const challenge = selectBalancedChallengeHoldout(records, 8);
  assert.equal(challenge.length, 16);
  assert.equal(challenge.filter((record) => record.fit_label === "fit").length, 8);
  assert.equal(challenge.filter((record) => record.fit_label === "not_fit").length, 8);
  assert.throws(() => selectBalancedChallengeHoldout(
    records.filter((record) => record.id !== "fit-0" && record.id !== "fit-1"),
    8
  ), /only 7 are available/);
});

test("benchmark summary separates provisional labels from benchmark-ready records", () => {
  const summary = summarizeGoldenRecords([
    {
      sport: "Volleyball",
      fit_label: "fit",
      achievability_label: "uncertain",
      benchmark_split: "excluded",
      point_in_time_reliability: "partial",
      decision_at: null,
      evidence_cutoff_at: null,
      decisive_information_publicly_knowable: null,
      labeled_at: null,
      stratification_tags: ["needs_sport_enrichment"],
    },
    {
      sport: "Needs enrichment",
      fit_label: "not_fit",
      achievability_label: "low",
      benchmark_split: "development",
      label_order_fit_before_outcome: true,
      point_in_time_reliability: "strong",
      decision_at: "2026-01-01T00:00:00Z",
      evidence_cutoff_at: "2025-12-31T00:00:00Z",
      decisive_information_publicly_knowable: true,
      labeled_at: "2026-08-10T00:00:00Z",
    },
  ]);
  assert.equal(summary.fit, 1);
  assert.equal(summary.usableFit, 0);
  assert.equal(summary.notFit, 1);
  assert.equal(summary.usableNotFit, 1);
  assert.equal(summary.positiveRemaining, 39);
  assert.equal(summary.negativeRemaining, 39);
  assert.equal(summary.censoredOutcomes, 0);
  assert.equal(summary.labelConflicts, 0);
  assert.equal(summary.needsSportEnrichment, 1);
});

test("Dylan outcome records do not require a second blind-label exercise", () => {
  assert.equal(isGoldenRecordReadyForSplit({
    benchmark_split: "excluded",
    sport: "Surfing",
    fit_label: "not_fit",
    achievability_label: "low",
    point_in_time_reliability: "strong",
    label_order_fit_before_outcome: false,
    decision_at: "2026-01-01T12:00:00Z",
    evidence_cutoff_at: "2026-01-01T12:00:00Z",
    decisive_information_publicly_knowable: null,
    labeled_at: "2026-08-11T12:00:00Z",
    stratification_tags: ["dylan_outcome_ground_truth"],
  }), true);
});

test("sport-unresolved Dylan records stay quarantined from split assignment", () => {
  assert.equal(isGoldenRecordReadyForSplit({
    benchmark_split: "excluded",
    sport: "Needs enrichment",
    fit_label: "fit",
    achievability_label: "high",
    point_in_time_reliability: "strong",
    label_order_fit_before_outcome: false,
    decision_at: "2026-01-01T12:00:00Z",
    evidence_cutoff_at: "2026-01-01T12:00:00Z",
    decisive_information_publicly_knowable: null,
    labeled_at: "2026-08-11T12:00:00Z",
    stratification_tags: ["dylan_outcome_ground_truth", "needs_sport_enrichment"],
  }), false);
});

test("a resolved sport is not hidden by a stale exhausted-enrichment tag", () => {
  assert.equal(isGoldenRecordReadyForSplit({
    benchmark_split: "excluded",
    sport: "Speed skating",
    fit_label: "fit",
    achievability_label: "high",
    point_in_time_reliability: "strong",
    label_order_fit_before_outcome: false,
    decision_at: "2026-02-11T12:00:00Z",
    evidence_cutoff_at: "2026-02-11T12:00:00Z",
    decisive_information_publicly_knowable: null,
    labeled_at: "2026-08-11T12:00:00Z",
    stratification_tags: ["dylan_outcome_ground_truth", "sport_enrichment_public_search_exhausted"],
  }), true);
});

test("benchmark metrics reward precision rather than score volume", () => {
  const base = {
    predictedFit: "fit" as const,
    predictedAchievability: "high" as const,
    priorityScore: 90,
    identityCorrect: true,
    eligibilityVerified: true,
    sourceVerificationRate: 1,
    unsupportedClaimRate: 0,
    pointInTimeCompliant: true,
    auditVerdict: "pass" as const,
    auditorCaughtResearcherFailure: false,
    researcherFailure: false,
    costMicrousd: 1_000,
    latencyMs: 2_000,
    inputTokens: 500,
    outputTokens: 100,
  };
  const metrics = calculateBenchmarkMetrics([
    { ...base, actualFit: "fit", actualAchievability: "high" },
    { ...base, actualFit: "not_fit", actualAchievability: "low", researcherFailure: true, auditorCaughtResearcherFailure: true },
  ]);
  assert.equal(metrics.precisionAbove80, 0.5);
  assert.equal(metrics.falsePositiveRate, 1);
  assert.equal(metrics.auditDecisionAccuracy, 0.5);
  assert.equal(metrics.outcomeAgreementRate, 0.5);
  assert.equal(metrics.auditorCatchRate, 1);
  assert.equal(metrics.finalistIdentityAccuracy, 1);
  assert.equal(metrics.finalistEligibilityVerificationRate, 1);
  assert.equal(metrics.finalistZeroUnsupportedClaimRate, 1);
  assert.equal(metrics.finalistAuditPassRate, 1);
  assert.equal(metrics.averageCostMicrousd, 1_000);
  assert.equal(metrics.costPerValidatedCandidateMicrousd, 2_000);
  assert.deepEqual(metrics.tokenUsage, {
    input: 1_000,
    output: 200,
    cacheCreationInput: 0,
    cacheReadInput: 0,
  });
});

test("benchmark metrics include rejected provider attempts in run accounting", () => {
  const metrics = calculateBenchmarkMetrics([{
    actualFit: "fit",
    actualAchievability: "high",
    predictedFit: "fit",
    predictedAchievability: "high",
    priorityScore: 90,
    identityCorrect: true,
    eligibilityVerified: true,
    sourceVerificationRate: 1,
    unsupportedClaimRate: 0,
    pointInTimeCompliant: true,
    auditVerdict: "pass",
    auditorCaughtResearcherFailure: false,
    researcherFailure: false,
    costMicrousd: 100_000,
    latencyMs: 2_000,
    inputTokens: 1_000,
    outputTokens: 200,
  }], 80, {
    totalCostMicrousd: 125_000,
    inputTokens: 1_400,
    outputTokens: 275,
    cacheCreationInputTokens: 50,
    cacheReadInputTokens: 75,
  });

  assert.equal(metrics.totalCostMicrousd, 125_000);
  assert.equal(metrics.averageCostMicrousd, 125_000);
  assert.equal(metrics.costPerValidatedCandidateMicrousd, 125_000);
  assert.deepEqual(metrics.tokenUsage, {
    input: 1_400,
    output: 275,
    cacheCreationInput: 50,
    cacheReadInput: 75,
  });
});

test("held-out release readiness requires every measured production gate", () => {
  const positive = {
    actualFit: "fit" as const,
    actualAchievability: "high" as const,
    predictedFit: "fit" as const,
    predictedAchievability: "high" as const,
    priorityScore: 88,
    identityCorrect: true,
    eligibilityVerified: true,
    sourceVerificationRate: 1,
    unsupportedClaimRate: 0,
    pointInTimeCompliant: true,
    auditVerdict: "pass" as const,
    auditorCaughtResearcherFailure: false,
    researcherFailure: false,
    costMicrousd: 1_000,
    latencyMs: 2_000,
  };
  const negative = {
    ...positive,
    actualFit: "not_fit" as const,
    actualAchievability: "low" as const,
    predictedFit: "not_fit" as const,
    predictedAchievability: "low" as const,
    priorityScore: 40,
    researcherFailure: true,
    auditorCaughtResearcherFailure: true,
    auditVerdict: "corrected" as const,
  };
  const passing = calculateBenchmarkMetrics([positive, negative]);
  assert.equal(evaluateBenchmarkReleaseReadiness(passing, { minimumCases: 2 }).ready, true);

  const noFinalist = calculateBenchmarkMetrics([{ ...positive, priorityScore: 79 }, negative]);
  assert.ok(evaluateBenchmarkReleaseReadiness(noFinalist, { minimumCases: 2 }).reasons
    .some((reason) => reason.includes("no score-above-80 finalist")));

  const failedAudit = calculateBenchmarkMetrics([{ ...positive, auditVerdict: "fail" }, negative]);
  assert.ok(evaluateBenchmarkReleaseReadiness(failedAudit, { minimumCases: 2 }).reasons
    .some((reason) => reason.includes("finalist audit pass rate")));
});

test("V2 priority cannot hide weak achievability or weak research confidence", () => {
  assert.equal(buildResearchV2Score({
    onlyfansFit: 98,
    commercialAchievability: 55,
    researchConfidence: 95,
  }).priority, 79);
  assert.equal(buildResearchV2Score({
    onlyfansFit: 98,
    commercialAchievability: 69,
    researchConfidence: 95,
  }).priority, 79);
  assert.equal(buildResearchV2Score({
    onlyfansFit: 98,
    commercialAchievability: 90,
    researchConfidence: 70,
  }).priority, 79);
  assert.equal(buildResearchV2Score({
    onlyfansFit: 92,
    commercialAchievability: 84,
    researchConfidence: 88,
  }).priority, 88.4);
});

test("V2 final gate requires independent audit and every evidence gate", () => {
  const score = buildResearchV2Score({
    onlyfansFit: 92,
    commercialAchievability: 84,
    researchConfidence: 88,
  });
  assert.equal(passesResearchV2FinalGate({
    ...score,
    identityConfirmed: true,
    adultEligibilityVerified: true,
    currentAthleticMomentumVerified: true,
    meaningfulAudienceVerified: true,
    creatorPotentialVerified: true,
    onlyFansPlatformActivityCompatible: true,
    commercialConstraintsComplete: true,
    materialClaimsVerified: true,
    auditorVerdict: "pass",
    criticalGapCount: 0,
  }), true);
  assert.equal(passesResearchV2FinalGate({
    ...score,
    identityConfirmed: true,
    adultEligibilityVerified: true,
    currentAthleticMomentumVerified: true,
    meaningfulAudienceVerified: true,
    creatorPotentialVerified: true,
    onlyFansPlatformActivityCompatible: true,
    commercialConstraintsComplete: true,
    materialClaimsVerified: true,
    auditorVerdict: "fail",
    criticalGapCount: 0,
  }), false);
  assert.equal(passesResearchV2FinalGate({
    ...score,
    identityConfirmed: true,
    adultEligibilityVerified: true,
    currentAthleticMomentumVerified: false,
    meaningfulAudienceVerified: true,
    creatorPotentialVerified: true,
    onlyFansPlatformActivityCompatible: true,
    commercialConstraintsComplete: true,
    materialClaimsVerified: true,
    auditorVerdict: "pass",
    criticalGapCount: 0,
  }), false);
});

test("V2 final gate fails closed on audience, creator, and commercial evidence", () => {
  const score = buildResearchV2Score({
    onlyfansFit: 92,
    commercialAchievability: 84,
    researchConfidence: 88,
  });
  const complete = {
    ...score,
    identityConfirmed: true,
    adultEligibilityVerified: true,
    currentAthleticMomentumVerified: true,
    meaningfulAudienceVerified: true,
    creatorPotentialVerified: true,
    onlyFansPlatformActivityCompatible: true,
    commercialConstraintsComplete: true,
    materialClaimsVerified: true,
    auditorVerdict: "pass" as const,
    criticalGapCount: 0,
  };
  assert.equal(passesResearchV2FinalGate({ ...complete, meaningfulAudienceVerified: false }), false);
  assert.equal(passesResearchV2FinalGate({ ...complete, creatorPotentialVerified: false }), false);
  assert.equal(passesResearchV2FinalGate({ ...complete, onlyFansPlatformActivityCompatible: false }), false);
  assert.equal(passesResearchV2FinalGate({ ...complete, commercialConstraintsComplete: false }), false);
});

test("OnlyFans platform signal accepts exact active profiles and blocks exact inactive profiles", () => {
  const active = selectOnlyFansPlatformSignal({
    athleteName: "Alex Example",
    instagramHandle: "alexexample",
    checkedAt: "2026-08-15T00:00:00.000Z",
    results: [{
      displayInput: "https://www.instagram.com/alexexample/",
      matchConfidence: "exact",
      ofFound: true,
      ofUsername: "alexexample",
      ofName: "Alex Example",
      ofIsActive: true,
      ofCanAddSubscriber: true,
      ofPostsCount: 24,
      ofLastSeen: "2026-08-10T00:00:00.000Z",
    }],
  });
  assert.equal(active.checkCompleted, true);
  assert.equal(active.exactMatch, true);
  assert.equal(active.status, "active");

  const inactive = selectOnlyFansPlatformSignal({
    athleteName: "Alex Example",
    instagramHandle: "alexexample",
    results: [{
      displayInput: "Alex Example",
      matchConfidence: "exact",
      ofFound: true,
      ofUsername: "alexexample",
      ofName: "Alex Example",
      ofIsActive: false,
      ofCanAddSubscriber: false,
    }],
  });
  assert.equal(inactive.exactMatch, true);
  assert.equal(inactive.status, "inactive");
});

test("OnlyFans platform signal treats no corroborated exact profile as neutral", () => {
  const signal = selectOnlyFansPlatformSignal({
    athleteName: "Alex Example",
    instagramHandle: "alexexample",
    results: [{
      displayInput: "Different Person",
      matchConfidence: "high",
      ofFound: true,
      ofUsername: "someoneelse",
      ofName: "Different Person",
      ofIsActive: false,
    }],
  });
  assert.equal(signal.checkCompleted, true);
  assert.equal(signal.exactMatch, false);
  assert.equal(signal.status, "not_found");

  const crossCandidate = selectOnlyFansPlatformSignal({
    athleteName: "Alex Example",
    instagramHandle: "alexexample",
    results: [{
      displayInput: "Other Alex Example",
      matchConfidence: "exact",
      ofFound: true,
      ofUsername: "notalexexample",
      ofName: "Alex Example",
      ofIsActive: false,
    }],
  });
  assert.equal(crossCandidate.exactMatch, false);
  assert.equal(crossCandidate.status, "not_found");
});

test("benchmark platform gate uses the newest explicit activity state and treats absence as neutral", () => {
  const evidence = (status: "active" | "inactive", effectiveAt: string) => ({
    sourceId: `${status}-${effectiveAt}`,
    claimId: `${status}-${effectiveAt}`,
    sourceRef: "E1",
    url: "https://example.com/profile",
    domain: "example.com",
    title: "OnlyFans profile status",
    claimType: "onlyfans_platform_activity_signal",
    claim: status === "active"
      ? "Alex Example's OnlyFans profile is active and open to subscribers."
      : "Alex Example's OnlyFans profile is inactive and closed to subscribers.",
    excerpt: status,
    effectiveAt,
    independenceGroup: "example.com",
    material: true,
    structuredValue: {},
  });
  assert.equal(benchmarkOnlyFansPlatformActivityGate([]).passed, true);
  assert.equal(benchmarkOnlyFansPlatformActivityGate([
    evidence("inactive", "2026-01-01T00:00:00.000Z"),
  ]).passed, false);
  assert.equal(benchmarkOnlyFansPlatformActivityGate([
    evidence("inactive", "2026-01-01T00:00:00.000Z"),
    evidence("active", "2026-02-01T00:00:00.000Z"),
  ]).status, "active");
});

test("blind and review scores are hard ceilings and can never inflate the researcher", () => {
  const constrained = buildAuditorConstrainedResearchV2Score({
    researcher: { onlyfansFit: 92, commercialAchievability: 84, researchConfidence: 88 },
    independentAudit: { onlyfansFit: 95, commercialAchievability: 68, researchConfidence: 82 },
    reviewCorrection: { onlyfansFit: 96, commercialAchievability: 90, researchConfidence: 80 },
  });
  assert.equal(constrained.onlyfansFit, 92);
  assert.equal(constrained.commercialAchievability, 68);
  assert.equal(constrained.researchConfidence, 80);
  assert.equal(constrained.priority, 79, "sub-70 independent achievability must cap the candidate below 80");
  assert.equal(holdResearchV2PriorityForIndependentAudit(88.4), 79);
  assert.equal(holdResearchV2PriorityForIndependentAudit(80), 80);
});

test("verified age above the recruiting profile maximum cannot become a finalist", () => {
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 81,
    age: 40,
    targetAgeMin: 21,
    maximumPriorityAge: 35,
  }), 69);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 81,
    age: 35,
    targetAgeMin: 21,
    maximumPriorityAge: 35,
  }), 81);
  const runner = readFileSync(new URL("../src/lib/research/benchmark-runner.ts", import.meta.url), "utf8");
  assert.match(runner, /benchmarkCorroboratedAgeAtCutoff/);
  assert.match(runner, /applyResearchObjectiveScoreGuardrails/);
});

test("the audit pipeline counts a deterministic false-finalist demotion as caught", () => {
  assert.equal(auditPipelineCaughtResearcherFailure({
    researcherFailure: true,
    finalPredictionCorrect: false,
    researcherPriority: 84,
    finalPriority: 69,
    actualPriority: false,
  }), true);
  assert.equal(auditPipelineCaughtResearcherFailure({
    researcherFailure: true,
    finalPredictionCorrect: false,
    researcherPriority: 84,
    finalPriority: 84,
    actualPriority: false,
  }), false);
});

test("V2 evidence citations must match a frozen source URL and source text", () => {
  const sources = [{
    url: "https://league.test/athletes/example?tracking=1",
    text: "Example Athlete earned rookie of the year after winning three events in 2026.",
  }];
  const supported = {
    signal: "Won rookie of the year in 2026",
    source_url: "https://league.test/athletes/example",
    source_excerpt: "earned rookie of the year after winning three events in 2026",
  };
  assert.equal(researchV2CitedSignalIsSourceBacked(supported, sources), true);
  assert.equal(hasSourceBackedResearchV2Signal([supported], sources), true);
  assert.equal(researchV2CitedSignalIsSourceBacked({
    ...supported,
    source_url: "https://unseen.test/example",
  }, sources), false);
  assert.equal(researchV2CitedSignalIsSourceBacked({
    ...supported,
    source_excerpt: "launched a daily lifestyle vlog and paid subscription community",
  }, sources), false);
});

test("meaningful audience uses the active minimum with a bounded engagement exception", () => {
  assert.equal(hasMeaningfulPersonalAudience({ followerCount: 30_000, engagementRate: 1, followerMinimum: 30_000 }), true);
  assert.equal(hasMeaningfulPersonalAudience({ followerCount: 15_000, engagementRate: 4.2, followerMinimum: 30_000 }), true);
  assert.equal(hasMeaningfulPersonalAudience({ followerCount: 15_000, engagementRate: 3.9, followerMinimum: 30_000 }), false);
  assert.equal(hasMeaningfulPersonalAudience({ followerCount: 9_999, engagementRate: 20, followerMinimum: 30_000 }), false);
});

test("live research evaluation exits before athlete writes and suppresses notifications", () => {
  const workflow = readFileSync(new URL("../src/app/api/research/run/workflow.ts", import.meta.url), "utf8");
  const finalistLoop = workflow.indexOf("for (const [finalistIndex, athlete] of finalResults.entries())");
  const evaluationGuard = workflow.indexOf("if (config.evaluationMode) {", finalistLoop);
  const evaluationContinue = workflow.indexOf("continue;", evaluationGuard);
  const liveAthleteInsert = workflow.indexOf('.from("athletes")\n            .insert({', evaluationContinue);
  const notificationGuard = workflow.indexOf("if (!config.evaluationMode) try", liveAthleteInsert);
  const notificationInsert = workflow.indexOf('.from("activity_notifications").insert({', notificationGuard);

  assert.ok(finalistLoop >= 0, "finalist persistence loop must exist");
  assert.ok(evaluationGuard > finalistLoop, "evaluation guard must be inside finalist persistence");
  assert.ok(evaluationContinue > evaluationGuard, "evaluation branch must exit the finalist iteration");
  assert.ok(liveAthleteInsert > evaluationContinue, "athlete insert must be unreachable after evaluation continue");
  assert.ok(notificationGuard > liveAthleteInsert && notificationInsert > notificationGuard, "notifications must be production-only");
  for (const forbiddenTable of ["messages", "channel_messages", "outreach_touchpoints", "message_drafts"]) {
    assert.ok(!workflow.includes(`from("${forbiddenTable}")`), `research workflow must not touch ${forbiddenTable}`);
  }
  assert.match(workflow, /athlete\.age_corroborated === true/);
  assert.match(workflow, /athlete\.identity_corroborated === true/);
  assert.match(workflow, /evaluateCorroboratedInstagramIdentity/);
  assert.match(workflow, /research-v2\.3-rubric-onlyfans-platform-activity-gate-v4/);
  assert.match(workflow, /two independent agreeing public sources/);
  assert.match(workflow, /lookupOnlyFansPlatformSignals/);
  assert.match(workflow, /OnlyFans platform check did not complete/);
  assert.ok(!workflow.includes("AVOID: athletes already on OnlyFans"));
});

test("evidence set hashes are order-independent but content-sensitive", () => {
  const left = stableEvidenceSetHash([{ url: "https://a.test", claim: "A" }, { url: "https://b.test", claim: "B" }]);
  const reordered = stableEvidenceSetHash([{ url: "https://b.test", claim: "B" }, { url: "https://a.test", claim: "A" }]);
  const changed = stableEvidenceSetHash([{ url: "https://a.test", claim: "Different" }, { url: "https://b.test", claim: "B" }]);
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
});

test("model prompts replace lone Unicode surrogates without damaging valid emoji", () => {
  const cleaned = sanitizeUnicodeForJson(`source \ud83d text \udc00 valid \ud83c\udfc4`);
  assert.equal(cleaned, "source � text � valid 🏄");
  assert.doesNotThrow(() => JSON.stringify({ prompt: cleaned }));
});

const BENCHMARK_CASE: BenchmarkGoldenCase = {
  id: "golden-safe",
  athlete_name: "Example Athlete",
  sport: "Beach Volleyball",
  benchmark_split: "development",
  benchmark_cohort_version: "cohort-v1",
  decision_at: "2025-06-15T00:00:00Z",
  evidence_cutoff_at: "2025-06-14T23:59:59Z",
  point_in_time_reliability: "strong",
  label_order_fit_before_outcome: true,
};

const BENCHMARK_SOURCES: BenchmarkEvidenceSourceRow[] = [
  ["sport-a", "https://league.test/example", "league.test", "League profile", "league", "public_web"],
  ["sport-b", "https://team.test/example", "team.test", "Team profile", "official_roster", "public_web"],
  ["age-a", "https://bio.test/example", "bio.test", "Example Athlete biography", "news", "public_web"],
  ["age-b", "https://university.test/example", "university.test", "Example Athlete roster", "university", "public_web"],
  ["outcome", "https://mail.test/private", "mail.test", "Private outcome", "internal_record", "gmail_mailbox_benchmark"],
  ["future", "https://future.test/example", "future.test", "Future article", "news", "public_web"],
].map(([id, canonical_url, domain, title, source_type, provider]) => ({
  id,
  golden_record_id: BENCHMARK_CASE.id,
  canonical_url,
  domain,
  title,
  publisher: domain,
  source_type,
  provider,
  published_at: id === "future" ? "2025-06-16T00:00:00Z" : "2025-06-01T00:00:00Z",
  retrieved_at: "2026-08-11T00:00:00Z",
  historical_as_of: null,
  retrieval_status: "retrieved",
  eligible_before_cutoff: true,
}));

const BENCHMARK_CLAIMS: BenchmarkEvidenceClaimRow[] = [
  ["sport-claim-a", "sport-a", "sport_identity", "Example Athlete is a Beach Volleyball athlete.", {}],
  ["sport-claim-b", "sport-b", "sport_identity", "Example Athlete competes in Beach Volleyball.", {}],
  ["age-claim-a", "age-a", "birth_date", "Example Athlete was born January 2, 1998.", { birth_date: "1998-01-02" }],
  ["age-claim-b", "age-b", "birth_date", "Example Athlete date of birth is 1998-01-02.", { birth_date: "1998-01-02" }],
  ["outcome-claim", "outcome", "historical_outcome", "The private record says this person signed.", {}],
  ["future-claim", "future", "candidate_evidence", "Example Athlete won a future event.", {}],
].map(([id, evidence_source_id, claim_type, claim_text, structured_value]) => ({
  id: id as string,
  golden_record_id: BENCHMARK_CASE.id,
  evidence_source_id: evidence_source_id as string,
  claim_type: claim_type as string,
  claim_text: claim_text as string,
  structured_value: structured_value as Record<string, unknown>,
  source_excerpt: claim_text as string,
  effective_at: null,
  observed_at: "2026-08-11T00:00:00Z",
  support_status: "supported",
  independence_group: null,
  material: true,
  eligible_for_scoring: true,
}));

test("benchmark evidence selection excludes private outcomes and post-cutoff facts", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: BENCHMARK_CASE,
    sources: BENCHMARK_SOURCES,
    claims: BENCHMARK_CLAIMS,
  });
  assert.deepEqual(selection.evidence.map((item) => item.claimId).sort(), [
    "age-claim-a", "age-claim-b", "sport-claim-a", "sport-claim-b",
  ]);
  assert.ok(selection.rejected.some((item) => item.claimId === "outcome-claim" && item.reason === "outcome_provider_excluded"));
  assert.ok(selection.rejected.some((item) => item.claimId === "future-claim" && item.reason === "after_evidence_cutoff"));
  assert.equal(selection.pointInTimeCompliant, true);
});

test("readiness selection does not crowd out late audience evidence behind generic claims", () => {
  const source: BenchmarkEvidenceSourceRow = {
    ...BENCHMARK_SOURCES[0],
    id: "dense-public-source",
    canonical_url: "https://public.test/example-athlete",
    domain: "public.test",
    title: "Example Athlete public profile",
    source_type: "social",
    provider: "social_blade_instagram_history",
    published_at: "2025-06-01T00:00:00Z",
  };
  const claims: BenchmarkEvidenceClaimRow[] = Array.from({ length: 35 }, (_, index) => ({
    ...BENCHMARK_CLAIMS[0],
    id: `generic-${index}`,
    evidence_source_id: source.id,
    claim_type: "candidate_evidence",
    claim_text: `Example Athlete generic public fact ${index}.`,
    source_excerpt: `Example Athlete generic public fact ${index}.`,
  }));
  claims.push({
    ...BENCHMARK_CLAIMS[0], id: "late-audience", evidence_source_id: source.id,
    claim_type: "audience_signal", claim_text: "Example Athlete had 120,000 followers.",
    source_excerpt: "Example Athlete had 120,000 followers.",
  }, {
    ...BENCHMARK_CLAIMS[0], id: "late-creator", evidence_source_id: source.id,
    claim_type: "creator_behavior_signal", claim_text: "Example Athlete had 400 published posts.",
    source_excerpt: "Example Athlete had 400 published posts.",
  });
  const selection = selectLeakageSafeBenchmarkEvidence({ record: BENCHMARK_CASE, sources: [source], claims });
  assert.equal(selection.evidence.length, 37);
  assert.equal(benchmarkCreatorPotentialGate(BENCHMARK_CASE, selection.evidence).passed, true);
});

test("benchmark material claims require a real frozen quote that supports the claim", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: BENCHMARK_CASE,
    sources: BENCHMARK_SOURCES,
    claims: BENCHMARK_CLAIMS,
  });
  const ageEvidence = selection.evidence.find((item) => item.claimId === "age-claim-a")!;
  const sportEvidence = selection.evidence.find((item) => item.claimId === "sport-claim-a")!;
  const supported = evaluateBenchmarkMaterialClaimCitations([{
    claim: "Example Athlete was born January 2, 1998.",
    evidence_support: [{ evidence_ref: ageEvidence.sourceRef, quote: ageEvidence.claim }],
  }], selection.evidence);
  assert.equal(supported.sourceVerificationRate, 1);
  assert.equal(supported.unsupportedClaimCount, 0);

  const fabricatedQuote = evaluateBenchmarkMaterialClaimCitations([{
    claim: "Example Athlete was born January 2, 1998.",
    evidence_support: [{ evidence_ref: ageEvidence.sourceRef, quote: "Example Athlete was born in California in 1998." }],
  }], selection.evidence);
  assert.equal(fabricatedQuote.unsupportedClaimCount, 1);

  const irrelevantQuote = evaluateBenchmarkMaterialClaimCitations([{
    claim: "Example Athlete was born January 2, 1998.",
    evidence_support: [{ evidence_ref: sportEvidence.sourceRef, quote: sportEvidence.claim }],
  }], selection.evidence);
  assert.equal(irrelevantQuote.unsupportedClaimCount, 1);
});

test("benchmark material claim support is evaluated across corroborating citations and numeric facts", () => {
  const evidence = [
    {
      sourceId: "age-a", claimId: "age-a", sourceRef: "E1", url: "https://one.test/athlete",
      domain: "one.test", title: "Pakita Ruiz profile", claimType: "adult_eligibility",
      claim: "Pakita Ruiz has an official competition birth date of 1997-08-11.",
      excerpt: "Pakita Ruiz has an official competition birth date of 1997-08-11.",
      effectiveAt: "2024-08-11T00:00:00Z", independenceGroup: "one.test", material: true,
      structuredValue: { birth_date: "1997-08-11" },
    },
    {
      sourceId: "age-b", claimId: "age-b", sourceRef: "E2", url: "https://two.test/athlete",
      domain: "two.test", title: "Pakita Ruiz turns 27", claimType: "adult_eligibility",
      claim: "Pakita Ruiz turned 27 on August 11, 2024.",
      excerpt: "Pakita Ruiz turned 27 on August 11, 2024.",
      effectiveAt: "2024-08-11T00:00:00Z", independenceGroup: "two.test", material: true,
      structuredValue: { age: 27 },
    },
  ];
  const quality = evaluateBenchmarkMaterialClaimCitations([{
    claim: "Pakita Ruiz's birth date is 1997-08-11, corroborated by an independent report that she turned 27 in August 2024.",
    evidence_support: [
      { evidence_ref: "E1", quote: evidence[0].claim },
      { evidence_ref: "E2", quote: evidence[1].claim },
    ],
  }], evidence);
  assert.equal(quality.sourceVerificationRate, 1);
});

test("models select evidence refs while application code emits immutable material claims", () => {
  const evidence = [
    {
      sourceId: "one", claimId: "one", sourceRef: "E1", url: "https://one.test/athlete",
      domain: "one.test", title: "Athlete profile", claimType: "sport_identity",
      claim: "Example Athlete competes in professional volleyball.", excerpt: "Example Athlete competes in professional volleyball.",
      effectiveAt: "2026-01-01T00:00:00Z", independenceGroup: "one.test", material: true, structuredValue: {},
    },
    {
      sourceId: "two", claimId: "two", sourceRef: "E2", url: "https://two.test/athlete",
      domain: "two.test", title: "Athlete audience", claimType: "audience_signal",
      claim: "Example Athlete had 25,000 followers.", excerpt: "Example Athlete had 25,000 followers.",
      effectiveAt: "2026-01-01T00:00:00Z", independenceGroup: "two.test", material: true, structuredValue: {},
    },
    {
      sourceId: "three", claimId: "three", sourceRef: "E3", url: "https://three.test/athlete",
      domain: "three.test", title: "Athlete creator activity", claimType: "creator_behavior_signal",
      claim: "Example Athlete publishes weekly training videos.", excerpt: "Example Athlete publishes weekly training videos.",
      effectiveAt: "2026-01-01T00:00:00Z", independenceGroup: "three.test", material: true, structuredValue: {},
    },
    {
      sourceId: "four", claimId: "four", sourceRef: "E4", url: "https://four.test/athlete",
      domain: "four.test", title: "Athlete result", claimType: "athletic_momentum",
      claim: "Example Athlete won a 2025 tournament.", excerpt: "Example Athlete won a 2025 tournament.",
      effectiveAt: "2025-06-01T00:00:00Z", independenceGroup: "four.test", material: true, structuredValue: {},
    },
  ];
  const claims = canonicalBenchmarkMaterialClaims(["E1", "E2", "E3", "E4"], evidence);
  assert.equal(claims.length, 4);
  assert.equal(claims[1].claim, evidence[1].claim);
  assert.deepEqual(claims[1].evidence_support, [{ evidence_ref: "E2", quote: evidence[1].claim }]);
  assert.equal(evaluateBenchmarkMaterialClaimCitations(claims, evidence).sourceVerificationRate, 1);
  assert.equal(evaluateBenchmarkMaterialClaimCitations(canonicalBenchmarkMaterialClaims(["E1", "E99"], evidence), evidence).unsupportedClaimCount > 0, true);
});

test("benchmark structured output parser accepts strict JSON and harmless provider wrappers only", () => {
  assert.deepEqual(parseBenchmarkStructuredJson<{ ok: boolean }>(' {"ok":true} '), { ok: true });
  assert.deepEqual(parseBenchmarkStructuredJson<{ ok: boolean }>('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseBenchmarkStructuredJson<{ ok: boolean }>([
    { type: "text", text: '{"ok":true}' },
  ]), { ok: true });
  assert.throws(() => parseBenchmarkStructuredJson("not json"), /invalid structured JSON/);
});

test("benchmark structured output validator rejects provider-renamed and missing fields", () => {
  const schema = {
    type: "object", additionalProperties: false,
    properties: { passed: { type: "boolean" }, score: { type: "number" } },
    required: ["passed", "score"],
  };
  assert.deepEqual(validateBenchmarkStructuredValue({ passed: true, score: 82 }, schema), []);
  const errors = validateBenchmarkStructuredValue({ audit_result: "PASS", score: 82 }, schema);
  assert.ok(errors.some((error) => error.includes("passed is required")));
  assert.ok(errors.some((error) => error.includes("audit_result is not allowed")));
});

test("benchmark finalist gates require two independent identity and adult sources", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: BENCHMARK_CASE,
    sources: BENCHMARK_SOURCES.filter((source) => source.id !== "future" && source.id !== "outcome"),
    claims: BENCHMARK_CLAIMS.filter((claim) => claim.id !== "future-claim" && claim.id !== "outcome-claim"),
  });
  assert.deepEqual(benchmarkIdentityGate(BENCHMARK_CASE, selection.evidence), { passed: true, independentSources: 2 });
  assert.deepEqual(benchmarkAdultEligibilityGate(BENCHMARK_CASE, selection.evidence), { passed: true, independentSources: 2 });
  assert.equal(benchmarkCorroboratedAgeAtCutoff(BENCHMARK_CASE, selection.evidence), 27);
  const birthDateDerivedAge = {
    ...selection.evidence.find((item) => item.claimId === "age-claim-b")!,
    structuredValue: {
      age: 27,
      age_as_of: "2025-06-01T00:00:00.000Z",
      precision: "birth_date",
    },
  };
  assert.equal(
    benchmarkCorroboratedAgeAtCutoff(BENCHMARK_CASE, [
      selection.evidence.find((item) => item.claimId === "age-claim-a")!,
      birthDateDerivedAge,
    ]),
    27,
    "an independent age explicitly derived from a birth date corroborates the exact date"
  );
  assert.equal(
    benchmarkCorroboratedAgeAtCutoff(BENCHMARK_CASE, [
      selection.evidence.find((item) => item.claimId === "age-claim-a")!,
      { ...birthDateDerivedAge, structuredValue: { age: 27 } },
    ]),
    null,
    "an ordinary stated age cannot trigger the deterministic age ceiling"
  );
  assert.equal(
    benchmarkCorroboratedAgeAtCutoff(BENCHMARK_CASE, [
      selection.evidence.find((item) => item.claimId === "age-claim-a")!,
      { ...birthDateDerivedAge, structuredValue: { ...birthDateDerivedAge.structuredValue, age: 26 } },
    ]),
    null,
    "a birth-date-derived age must agree with the exact date at the observation time"
  );
  const contradictoryAge = {
    ...selection.evidence.find((item) => item.claimId === "age-claim-b")!,
    sourceId: "age-conflict",
    claimId: "age-conflict",
    sourceRef: "E98",
    independenceGroup: "conflicting-bio.test",
    structuredValue: { birth_date: "1997-01-02" },
  };
  assert.deepEqual(benchmarkAdultEligibilityGate(BENCHMARK_CASE, [...selection.evidence, contradictoryAge]), {
    passed: false,
    independentSources: 3,
  });
  const staleApproximateAge = {
    ...selection.evidence.find((item) => item.claimId === "age-claim-b")!,
    sourceId: "stale-age",
    claimId: "stale-age",
    sourceRef: "E97",
    independenceGroup: "stale-profile.test",
    structuredValue: { age: 23 },
    effectiveAt: "2025-06-01T00:00:00.000Z",
  };
  assert.deepEqual(benchmarkAdultEligibilityGate(BENCHMARK_CASE, [...selection.evidence, staleApproximateAge]), {
    passed: true,
    independentSources: 3,
  }, "two matching exact birth dates outrank a stale approximate-age snippet");
  assert.equal(benchmarkCaseReadiness({ record: BENCHMARK_CASE, selection }).ready, true);
  const revealedReplayRecord = {
    ...BENCHMARK_CASE,
    benchmark_split: "held_out" as const,
    held_out_locked_at: "2026-01-01T00:00:00.000Z",
    held_out_revealed_at: "2026-01-02T00:00:00.000Z",
  };
  assert.deepEqual(
    benchmarkCaseReadiness({ record: revealedReplayRecord, selection }).reasons,
    ["held-out record is not locked and unrevealed"],
    "a revealed held-out case must fail closed by default",
  );
  assert.equal(benchmarkCaseReadiness({
    record: revealedReplayRecord,
    selection,
    allowRevealedHeldOutReplay: true,
  }).ready, true, "an explicitly marked development replay may reuse a revealed archive");
  const creatorReadySelection = {
    ...selection,
    evidence: [
      ...selection.evidence,
      {
        ...selection.evidence[0], sourceId: "audience", claimId: "audience", sourceRef: "E5",
        claimType: "audience_signal", claim: "Example Athlete had 122,000 followers.",
      },
      {
        ...selection.evidence[1], sourceId: "creator", claimId: "creator", sourceRef: "E6",
        claimType: "creator_behavior_signal", claim: "Example Athlete posted weekly tournament vlogs.",
      },
      {
        ...selection.evidence[0], sourceId: "momentum", claimId: "momentum", sourceRef: "E7",
        claimType: "athletic_momentum", claim: "Example Athlete won a Beach Volleyball event.",
        effectiveAt: "2025-04-01T00:00:00.000Z",
      },
    ],
  };
  assert.equal(benchmarkEvidenceFreezeReadiness({
    record: BENCHMARK_CASE,
    fitLabel: "fit",
    selection: creatorReadySelection,
  }).ready, true);
  assert.equal(benchmarkAdultEligibilityGate(BENCHMARK_CASE, selection.evidence.filter((item) => item.sourceId !== "age-b")).passed, false);
  const recentMomentum = {
    ...selection.evidence[0],
    sourceId: "momentum-recent",
    claimId: "momentum-recent",
    sourceRef: "E99",
    title: "Example Athlete wins Beach Volleyball event",
    claimType: "athletic_momentum",
    claim: "Example Athlete won a Beach Volleyball event.",
    excerpt: "Example Athlete won a Beach Volleyball event.",
    effectiveAt: "2025-04-01T00:00:00.000Z",
  };
  assert.equal(benchmarkCurrentMomentumGate(BENCHMARK_CASE, [...selection.evidence, recentMomentum]).passed, true);
  assert.equal(benchmarkCurrentMomentumGate(BENCHMARK_CASE, [
    { ...recentMomentum, effectiveAt: "2022-04-01T00:00:00.000Z" },
  ]).passed, false);
  assert.equal(benchmarkCurrentMomentumGate(BENCHMARK_CASE, [{
    ...recentMomentum,
    claimType: "candidate_evidence",
    title: "Example Athlete results, medals, and highlights",
    claim: "Example Athlete results and profile.",
    excerpt: "Example Athlete results and profile.",
    effectiveAt: "2025-04-01T00:00:00.000Z",
  }]).passed, true);
  assert.equal(benchmarkCurrentMomentumGate(BENCHMARK_CASE, [{
    ...recentMomentum,
    claimType: "candidate_evidence",
    title: "Example Athlete team profile",
    claim: "Example Athlete is listed as a pro team rider.",
    excerpt: "Example Athlete is listed as a pro team rider.",
    effectiveAt: "2025-04-01T00:00:00.000Z",
  }]).passed, true);
  assert.equal(benchmarkCurrentMomentumGate(BENCHMARK_CASE, [{
    ...recentMomentum,
    claimType: "candidate_evidence",
    title: "Example Athlete profile",
    claim: "Example Athlete won a Beach Volleyball championship in 2021.",
    excerpt: "Example Athlete won a Beach Volleyball championship in 2021.",
    effectiveAt: "2025-04-01T00:00:00.000Z",
  }]).passed, false);
  const missingAge = { ...selection, evidence: selection.evidence.filter((item) => item.sourceId !== "age-b") };
  assert.ok(benchmarkEvidenceFreezeReadiness({
    record: BENCHMARK_CASE,
    fitLabel: "fit",
    selection: missingAge,
  }).reasons.includes("fit record lacks two-source 21+ corroboration"));

  const summary = summarizeBenchmarkEvidenceReadiness([{
    record: BENCHMARK_CASE,
    fitLabel: "fit",
    selection: creatorReadySelection,
  }, {
    record: { ...BENCHMARK_CASE, id: "missing-evidence" },
    fitLabel: "not_fit",
    selection: { evidence: [], rejected: [], totalClaims: 0, pointInTimeCompliant: true },
  }]);
  assert.equal(summary.totalRecords, 2);
  assert.equal(summary.readyForFreeze, 1);
  assert.equal(summary.readyFit, 1);
  assert.equal(summary.readyNotFit, 0);
  assert.equal(summary.recordsWithAnySafeEvidence, 1);
  assert.equal(summary.safeClaimCount, 7);
  assert.equal(summary.blockerCounts["fewer than four supported public claims exist before the cutoff"], 1);
});

test("deterministic benchmark precheck exposes evidence gates without labels or outcomes", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: BENCHMARK_CASE,
    sources: BENCHMARK_SOURCES.filter((source) => source.id !== "future" && source.id !== "outcome"),
    claims: BENCHMARK_CLAIMS.filter((claim) => claim.id !== "future-claim" && claim.id !== "outcome-claim"),
  });
  const summary = benchmarkDeterministicGateSummary(BENCHMARK_CASE, selection.evidence);
  assert.equal(summary.identity.passed, true);
  assert.equal(summary.adultEligibility.passed, true);
  assert.equal(summary.adultEligibility.verifiedAgeAtCutoff, 27);
  assert.equal(typeof summary.allCoreEvidenceGatesPassed, "boolean");
  assert.equal("fit_label" in summary, false);
});

test("dated stated-age evidence matures conservatively by the cutoff", () => {
  const baseAgeEvidence = {
    ...selectLeakageSafeBenchmarkEvidence({
      record: BENCHMARK_CASE,
      sources: BENCHMARK_SOURCES.filter((source) => source.id === "age-a"),
      claims: BENCHMARK_CLAIMS.filter((claim) => claim.id === "age-claim-a"),
    }).evidence[0],
    claimType: "adult_eligibility",
    claim: "Example Athlete was age 19.",
    excerpt: "Example Athlete profile. Age: 19.",
    structuredValue: { age: 19 },
    effectiveAt: "2022-01-01T00:00:00.000Z",
  };
  const corroboratingAge = {
    ...baseAgeEvidence,
    sourceId: "age-b",
    claimId: "age-b-stated",
    sourceRef: "E2",
    independenceGroup: "university.test",
  };
  assert.deepEqual(benchmarkAdultEligibilityGate(BENCHMARK_CASE, [baseAgeEvidence, corroboratingAge]), {
    passed: true,
    independentSources: 2,
  });
  assert.equal(benchmarkAdultEligibilityGate(BENCHMARK_CASE, [
    { ...baseAgeEvidence, effectiveAt: "2024-07-01T00:00:00.000Z" },
    { ...corroboratingAge, effectiveAt: "2024-07-01T00:00:00.000Z" },
  ]).passed, false);
});

test("benchmark prompts are constructed from a safe whitelist and never expose labels or outcomes", () => {
  const record = {
    ...BENCHMARK_CASE,
    fit_label: "private-positive-label",
    achievability_label: "private-high-label",
    final_outcome: "private-signed-outcome",
    primary_reason: "private-economics-reason",
    explanation: "SECRET OUTCOME EXPLANATION",
    internal_record_reference: "gmail:private-thread-123",
  };
  const selection = selectLeakageSafeBenchmarkEvidence({
    record,
    sources: BENCHMARK_SOURCES.filter((source) => source.id !== "future" && source.id !== "outcome"),
    claims: BENCHMARK_CLAIMS.filter((claim) => claim.id !== "future-claim" && claim.id !== "outcome-claim"),
  });
  const thesis = `=== ACTIVE RECRUITING THESIS ===
SPORT PRIORITIES:
- Deprioritize mature combat-sports categories unless current evidence is exceptional.`;
  const prompt = buildBenchmarkResearcherPrompt(record, selection.evidence, undefined, thesis);
  assert.equal(promptContainsBenchmarkLeakage(prompt, record), false);
  assert.ok(prompt.includes("Example Athlete"));
  assert.ok(prompt.includes("E1"));
  assert.ok(prompt.includes("FROZEN BUSINESS THESIS"));
  assert.ok(prompt.includes("Deprioritize mature combat-sports categories"));
  assert.ok(prompt.includes("not evidence about this candidate"));
  assert.ok(prompt.includes("allCoreEvidenceGatesPassed is true"));
  assert.ok(prompt.includes("mandatory floors and ceilings"));
  assert.ok(prompt.includes("Age and general career stature are not such contradictions"));
  assert.ok(!prompt.includes("SECRET OUTCOME"));
  assert.ok(!prompt.includes("gmail:private"));
});

test("Sonnet benchmark cost admission uses a dated price snapshot and conservative projection", () => {
  const introductory = sonnetPriceSnapshot("claude-sonnet-5", new Date("2026-08-11T00:00:00Z"));
  assert.equal(introductory.provider, "anthropic");
  assert.equal(introductory.inputUsdPerMillion, 2);
  assert.equal(introductory.outputUsdPerMillion, 10);
  assert.equal(estimateBenchmarkCostMicrousd({
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }, introductory), 12_000_000);
  assert.equal(projectedBenchmarkCallCostMicrousd({
    promptCharacters: 1_000,
    maximumOutputTokens: 100,
    price: introductory,
  }), 3_000);
  assert.throws(() => sonnetPriceSnapshot("claude-sonnet-6", new Date("2026-08-11T00:00:00Z")), /Pricing is not configured/);
});

test("OpenRouter benchmark selection chooses the latest structured-output Sonnet and snapshots catalog pricing", () => {
  const selected = selectLatestOpenRouterSonnet([
    {
      id: "anthropic/claude-sonnet-4.6",
      created: 100,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["response_format"],
    },
    {
      id: "anthropic/claude-sonnet-5:batch",
      created: 300,
      pricing: { prompt: "0.000001", completion: "0.000005" },
      supported_parameters: ["response_format"],
    },
    {
      id: "anthropic/claude-sonnet-5",
      created: 200,
      pricing: {
        prompt: "0.000002",
        completion: "0.000010",
        input_cache_read: "0.0000002",
        input_cache_write: "0.0000025",
      },
      supported_parameters: ["structured_outputs"],
    },
    {
      id: "anthropic/claude-sonnet-unpriced",
      created: 150,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["response_format"],
    },
    {
      id: "openai/gpt-future",
      created: 400,
      pricing: { prompt: "0.000001", completion: "0.000001" },
      supported_parameters: ["response_format"],
    },
  ]);

  assert.equal(selected?.model, "anthropic/claude-sonnet-5");
  assert.equal(selected?.price.provider, "openrouter");
  assert.equal(selected?.price.inputUsdPerMillion, 2);
  assert.equal(selected?.price.outputUsdPerMillion, 10);
  assert.equal(selected?.price.cacheReadUsdPerMillion, 0.2);
  assert.equal(selected?.price.cacheCreationUsdPerMillion, 2.5);
  assert.equal(selectLatestOpenRouterSonnet([{
    id: "anthropic/claude-sonnet-5",
    created: 200,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["response_format"],
  }]), null);
  assert.equal(selectLatestOpenRouterSonnet([{
    id: "anthropic/claude-sonnet-6",
    created: 300,
    pricing: { prompt: "0.000003", completion: "0.000015" },
    supported_parameters: ["tools"],
  }, {
    id: "anthropic/claude-sonnet-5",
    created: 200,
    pricing: { prompt: "0.000002", completion: "0.000010" },
    supported_parameters: ["response_format"],
  }]), null, "an incompatible newest release must fail closed instead of silently using an older Sonnet");
});

test("OpenRouter usage separates cache reads and writes and preserves provider-reported cost", () => {
  assert.deepEqual(normalizeOpenRouterBenchmarkUsage({
    prompt_tokens: 1_000,
    completion_tokens: 125,
    cost: 0.004321,
    prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 250 },
  }), {
    usage: {
      inputTokens: 150,
      outputTokens: 125,
      cacheCreationInputTokens: 250,
      cacheReadInputTokens: 600,
    },
    reportedCostMicrousd: 4_321,
  });
});

test("benchmark model dossiers keep the strongest bounded evidence per dimension", () => {
  const items = [
    ...Array.from({ length: 5 }, (_, index) => ({ claimType: "sport_identity", domain: `sport${index}.test` })),
    ...Array.from({ length: 4 }, (_, index) => ({ claimType: "adult_eligibility", domain: `age${index}.test` })),
    ...Array.from({ length: 5 }, (_, index) => ({ claimType: "athletic_momentum", domain: `momentum${index}.test` })),
    ...Array.from({ length: 4 }, (_, index) => ({ claimType: "audience_signal", domain: `audience${index}.test` })),
    ...Array.from({ length: 4 }, (_, index) => ({ claimType: "commercial_achievability_signal", domain: `commercial${index}.test` })),
    ...Array.from({ length: 4 }, (_, index) => ({ claimType: "candidate_evidence", domain: `candidate${index}.test` })),
  ].map((item, index) => ({
    sourceId: `source-${index}`, claimId: `claim-${index}`, sourceRef: `OLD${index}`, url: `https://${item.domain}/${index}`,
    domain: item.domain, title: `Evidence ${index}`, claimType: item.claimType, claim: `Claim ${index}`, excerpt: `Excerpt ${index}`,
    effectiveAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`, independenceGroup: item.domain,
    material: true, structuredValue: item.claimType === "adult_eligibility" ? { birth_date: "1998-01-01" } : {},
  }));
  const compact = compactBenchmarkModelEvidence(items);
  assert.equal(compact.length, 13);
  assert.deepEqual(compact.map((item) => item.sourceRef), Array.from({ length: 13 }, (_, index) => `E${index + 1}`));
  assert.equal(compact.filter((item) => item.claimType === "sport_identity").length, 2);
  assert.equal(compact.filter((item) => item.claimType === "adult_eligibility").length, 2);
  assert.equal(compact.filter((item) => item.claimType === "athletic_momentum").length, 3);
  const rankedCandidates = compactBenchmarkModelEvidence([
    {
      sourceId: "generic", claimId: "generic", sourceRef: "", url: "https://new.example/profile",
      domain: "new.example", title: "Recent athlete profile", claimType: "candidate_evidence",
      claim: "Athlete profile and biography.", excerpt: "A recent generic athlete biography.",
      effectiveAt: "2026-01-01T00:00:00Z", independenceGroup: "new.example", material: true, structuredValue: {},
    },
    {
      sourceId: "signal", claimId: "signal", sourceRef: "", url: "https://older.example/partnership",
      domain: "older.example", title: "Athlete joins pro team", claimType: "candidate_evidence",
      claim: "The athlete is a sponsored team rider with 80,000 followers and regular training videos.",
      excerpt: "Sponsored pro team rider with 80,000 followers and behind-the-scenes training content.",
      effectiveAt: "2025-01-01T00:00:00Z", independenceGroup: "older.example", material: true, structuredValue: {},
    },
  ]);
  assert.equal(rankedCandidates[0].claimId, "signal");
});

test("benchmark execution is evaluation-only and cannot mutate outreach or live pipeline tables", () => {
  const source = readFileSync(new URL("../src/lib/research/benchmark-runner.ts", import.meta.url), "utf8");
  for (const forbiddenTable of [
    "athletes", "research_candidates", "pipeline_athletes", "notifications",
    "messages", "outreach_touchpoints", "channel_messages",
  ]) {
    assert.ok(!source.includes(`from(\"${forbiddenTable}\")`), `benchmark runner must not write ${forbiddenTable}`);
  }
  assert.ok(source.includes('score_stage: "benchmark"'));
  assert.ok(source.includes("no_outreach: true"));
  assert.ok(source.includes('data_collection: "deny"'));
  assert.ok(source.includes("providerReportedCostMicrousd"));
  assert.match(source, /research-v2-benchmark-runner-v29/);
  assert.match(source, /researcherOutputTokens: 3_200/);
  assert.match(source, /blindOutputTokens: 3_000/);
  assert.match(source, /reviewOutputTokens: 2_600/);
  assert.match(source, /reasoning: \{ effort: attempt === 1 \? "medium" : "low", exclude: true \}/);
  assert.match(source, /call_limits: BENCHMARK_CALL_LIMITS/);
  assert.match(source, /recruiting_profile_version_id: profileVersionId/);
  assert.match(source, /recruiting_profile_hash: profileHash/);
  assert.match(source, /recruiting_profile_snapshot: profileSnapshot/);
  assert.match(source, /development baseline recruiting-thesis snapshot failed its content-hash check/);
  assert.match(source, /latest Sonnet release or provider route changed after development/);
  assert.match(source, /publish a candidate-blind thesis before benchmarking/);
  assert.match(source, /This thesis defines current business priorities only/);
  assert.match(source, /maximumOutputTokens: run\.metrics\.call_limits\.blindOutputTokens/);
  assert.match(source, /0-100 numeric scale, never fractions from 0 to 1/);
  assert.match(source, /Do not require evidence that the athlete wants OnlyFans or adult content/);
  assert.match(source, /Missing representation alone is not automatically critical/);
  assert.match(source, /BENCHMARK_PRE_OUTREACH_CALIBRATION/);
  assert.match(source, /auditPipelineCaughtResearcherFailure/);
  assert.match(source, /const finalHigh = finalCorrected\.priority > 80/);
  assert.match(source, /compatible replay checkpoint; start a fresh development smoke test/);
  assert.match(source, /Development release gates have not passed/);
  assert.ok(!source.includes("researcher.unsupported_claims"), "unsupported researcher claims must come from citation validity, not self-report");
  assert.ok(!source.includes("blind.unsupported_claims"), "blind limitations must not be counted as unsupported material claims");
  assert.match(source, /compactBenchmarkModelEvidence/);
  assert.match(source, /evaluateBenchmarkMaterialClaimCitations/);
  assert.match(source, /buildAuditorConstrainedResearchV2Score/);
  assert.match(source, /passesResearchV2FinalGate/);
  assert.match(source, /Never raise a Researcher or blind-auditor dimension/);
  assert.match(source, /review\.verdict === "fail" \? \(blind\.critical_gaps/);
  assert.ok(!source.includes('(researcherPriority > 80) !== actualPriority'), "a deliberately selective finalist threshold must not be treated as a classifier miss");
  assert.ok(!source.includes('...(blind.failure_types || []).map(normalizeFailureType)'), "candidate evidence gaps must not be logged as research-system failures");
  assert.match(source, /filter\(actionableReviewFinding\)/);
  assert.ok(!source.includes("minimum: 0"), "Anthropic structured outputs reject numeric minimum keywords");
  assert.ok(!source.includes("maximum: 100"), "Anthropic structured outputs reject numeric maximum keywords");
  assert.match(source, /status: "draft"/);
  assert.match(source, /rubricArchiveError/);
  assert.ok(source.indexOf("rubricArchiveError") < source.indexOf("rubricActivateError"), "the previous rubric must be archived before the new one is activated");
  assert.match(source, /update\(\{ status: "archived" \}\)/);
  assert.match(source, /BENCHMARK_GOLDEN_RECORD_SELECT = .*stratification_tags/);
  assert.equal((source.match(/\.select\(BENCHMARK_GOLDEN_RECORD_SELECT\)/g) || []).length, 3,
    "run start, revealed development replay, and checkpoint resume must load the same ground-truth fields");
});

test("benchmark progress excludes researcher-only partial checkpoints", () => {
  const route = readFileSync(new URL("../src/app/api/research/benchmarks/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!row\.audit_id\) return null/);
});

test("benchmark sport enrichment associates only the exact quoted athlete query", () => {
  const records = [
    { id: "anna", athlete_name: "Anna Bright" },
    { id: "ann", athlete_name: "Ann Li" },
  ];
  const grouped = groupBenchmarkSearchResults(records, [{
    searchQuery: { term: '"Anna Bright" athlete sport official profile' },
    organicResults: [
      { title: "Anna Bright | PPA Tour", url: "https://example.com/anna", description: "Anna Bright is a professional pickleball athlete." },
      { title: "Unsafe", url: "http://example.com/unsafe", description: "Anna Bright" },
    ],
  }]);
  assert.equal(grouped.get("anna")?.length, 1);
  assert.equal(grouped.get("ann")?.length, 0);
  assert.equal(benchmarkSourceNamesAthlete("Ann Li", "Joann Lister plays tennis"), false);
});

test("benchmark sport enrichment rejects wrong names, weak confidence, and invented sources", () => {
  const record = { id: "anna", athlete_name: "Anna Bright" };
  const sources = [{
    title: "Anna Bright | PPA Tour",
    url: "https://example.com/anna",
    snippet: "Anna Bright is a professional pickleball athlete.",
  }, {
    title: "Anna Bright athlete profile",
    url: "https://ppa.example.org/players/anna-bright",
    snippet: "Professional pickleball player Anna Bright competes on the PPA Tour.",
  }];
  const valid = {
    golden_record_id: "anna",
    athlete_name: "Anna Bright",
    sport: "Pickleball" as const,
    confidence: 96,
    source_url: "https://example.com/anna",
    corroborating_source_url: "https://ppa.example.org/players/anna-bright",
    source_title: "Anna Bright | PPA Tour",
    source_excerpt: "Professional pickleball athlete",
    identity_ambiguous: false,
    identity_evidence: "Both independent sources identify the same pickleball athlete.",
  };
  assert.ok(validateBenchmarkSportClassification(valid, record, sources));
  assert.equal(validateBenchmarkSportClassification({ ...valid, athlete_name: "Anna Leigh Waters" }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, confidence: 89 }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, source_url: "https://invented.test" }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, identity_ambiguous: true }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, corroborating_source_url: valid.source_url }, record, sources), null);
});

test("benchmark sport enrichment rejects same-name sport collisions and same-domain corroboration", () => {
  const record = { id: "javier", athlete_name: "Javier Garrido" };
  const sources = [
    { title: "Javier Garrido football profile", url: "https://sports.test/javier", snippet: "Football player Javier Garrido is a defender." },
    { title: "Javier Garrido padel profile", url: "https://padel.test/javier", snippet: "Javier Garrido is a professional padel player." },
    { title: "Javier Garrido football archive", url: "https://archive.test/javier", snippet: "Footballer Javier Garrido played as a defender." },
  ];
  const classification = {
    golden_record_id: "javier", athlete_name: "Javier Garrido", sport: "Soccer" as const, confidence: 98,
    source_url: sources[0].url, corroborating_source_url: sources[2].url,
    source_title: sources[0].title, source_excerpt: sources[0].snippet,
    identity_ambiguous: false, identity_evidence: "Two football sources",
  };
  assert.deepEqual([...benchmarkSportHints(record.athlete_name, sources)].sort(), ["Padel", "Soccer"]);
  assert.equal(validateBenchmarkSportClassification(classification, record, sources), null);

  const sameDomain = sources.slice(0, 1).concat({
    title: "Javier Garrido football stats", url: "https://stats.sports.test/javier", snippet: "Footballer Javier Garrido stats.",
  });
  assert.equal(benchmarkSourceDomain(sources[0].url), benchmarkSourceDomain(sameDomain[1].url));
  assert.equal(validateBenchmarkSportClassification({
    ...classification, corroborating_source_url: sameDomain[1].url,
  }, record, sameDomain), null);
});

test("benchmark sport enrichment rejects a spelling-only near match", () => {
  const record = { id: "jeremy", athlete_name: "Jeremy Mallott" };
  const sources = [
    { title: "Jeremy Malott BMX", url: "https://one.test/jeremy", snippet: "BMX rider Jeremy Malott." },
    { title: "Jeremy Malott profile", url: "https://two.test/jeremy", snippet: "Jeremy Malott competes in BMX." },
  ];
  assert.equal(benchmarkSourceNamesAthlete(record.athlete_name, `${sources[0].title} ${sources[0].snippet}`), false);
});

test("historical evidence accepts Dylan's broad sport labels without weakening canonical classification", () => {
  const examples: Array<[string, string]> = [
    ["American Football", "Josh Butler played NCAA football before entering the NFL."],
    ["Aquabike", "Estelle Poret is a French jet ski world champion."],
    ["Beach Volleyball", "Olivia Macdonald is a beach volleyball athlete."],
    ["Bare-knuckle boxing", "Gastón Reyno es un peleador profesional de artes marciales mixtas."],
    ["Cliff Diving", "Carlos Gimeno competes on the Red Bull Cliff Diving World Series."],
    ["Combat Sports", "Payton Talbott is a UFC mixed martial arts fighter."],
    ["Football", "Kerstin Casparij is a women's footballer and soccer defender."],
    ["Football / soccer", "Lola Gallardo is a Spanish footballer and goalkeeper."],
    ["Jet Ski / Aquabike", "Estelle Poret competes in aquabike racing."],
    ["MMA / LFA", "Allan Begosso fought for Legacy Fighting Alliance."],
    ["Motorcycle Road Racing", "Davey Todd is an Isle of Man TT road racer."],
    ["Racquet Sports", "Claudia Jensen is a professional pickleball player."],
    ["Supercross / Motocross", "Dean Wilson is a supercross rider."],
  ];
  for (const [sport, source] of examples) assert.equal(benchmarkSourceSupportsSport(sport, source), true, sport);
  assert.equal(benchmarkSourceSupportsSport("Combat Sports", "Payton Talbott plays professional baseball."), false);
});

test("benchmark sport enrichment uses Sonnet-compatible structured output schema", () => {
  const source = readFileSync(new URL("../src/lib/research/benchmark-sport-enrichment.ts", import.meta.url), "utf8");
  assert.match(source, /confidence: \{ type: "integer" \}/);
  assert.doesNotMatch(source, /confidence: \{ type: "integer", (minimum|maximum)/);
  assert.match(source, /output_config: \{ effort: "low", format:/);
  assert.match(source, /SPORT_CLASSIFICATION_BATCH_SIZE = 5/);
  assert.match(source, /resolveAnthropicScoringModel\(\)/);
  assert.match(source, /Promise\.all\(batches\.map/);
  assert.match(source, /failures\.push\(\.\.\.checkpoint\.batch\.map/);
  assert.match(source, /sport_enrichment_identity_conflict/);
  assert.match(source, /sport_enrichment_public_search_exhausted/);
});

test("Wayback selection uses the latest exact HTML capture no later than the evidence cutoff", () => {
  const canonicalUrl = "https://sports.example/athletes/jane-doe";
  const capture = selectWaybackCapture([
    ["timestamp", "original", "statuscode", "digest", "mimetype"],
    ["20240301010101", canonicalUrl, "200", "OLD", "text/html"],
    ["20240501010101", canonicalUrl, "200", "LATEST", "text/html"],
    ["20240701010101", canonicalUrl, "200", "FUTURE", "text/html"],
    ["20240401010101", "https://sports.example/athletes/other", "200", "WRONG", "text/html"],
    ["20240402010101", canonicalUrl, "200", "PDF", "application/pdf"],
  ], canonicalUrl, "2024-06-01T00:00:00Z");

  assert.equal(capture?.timestamp, "20240501010101");
  assert.equal(capture?.digest, "LATEST");
  assert.equal(capture?.archivedUrl, `https://web.archive.org/web/20240501010101id_/${canonicalUrl}`);
  assert.equal(parseWaybackTimestamp("20240230010101"), null);
  assert.equal(selectWaybackCapture([["timestamp", "original", "statuscode"]], canonicalUrl, "2024-06-01T00:00:00Z"), null);
  const pdfUrl = "https://sports.example/seeding/current-list.pdf";
  assert.equal(selectWaybackCapture([
    ["timestamp", "original", "statuscode", "digest", "mimetype"],
    ["20240501010101", pdfUrl, "200", "PDF", "application/pdf"],
    ["20240502010101", pdfUrl, "200", "HTML", "text/html"],
  ], pdfUrl, "2024-06-01T00:00:00Z")?.digest, "PDF");
  const cdxUrl = new URL(waybackCdxUrl(canonicalUrl, "2024-06-01T12:34:56Z"));
  assert.equal(cdxUrl.hostname, "web.archive.org");
  assert.equal(cdxUrl.searchParams.get("matchType"), "exact");
  assert.equal(cdxUrl.searchParams.get("to"), "20240601123456");
  const availabilityUrl = new URL(waybackAvailabilityUrl(canonicalUrl, "2024-06-01T12:34:56Z"));
  assert.equal(availabilityUrl.hostname, "archive.org");
  assert.equal(availabilityUrl.searchParams.get("timestamp"), "20240601123456");
  const availableCapture = selectWaybackAvailabilityCapture({
    url: canonicalUrl,
    archived_snapshots: {
      closest: {
        available: true,
        status: "200",
        timestamp: "20240501010101",
        url: `http://web.archive.org/web/20240501010101/${canonicalUrl}`,
      },
    },
  }, canonicalUrl, "2024-06-01T00:00:00Z");
  assert.equal(availableCapture?.timestamp, "20240501010101");
  assert.equal(availableCapture?.archivedUrl, `https://web.archive.org/web/20240501010101id_/${canonicalUrl}`);
  assert.equal(selectWaybackAvailabilityCapture({
    url: canonicalUrl,
    archived_snapshots: { closest: { available: true, status: "200", timestamp: "20240701010101" } },
  }, canonicalUrl, "2024-06-01T00:00:00Z"), null);
  assert.equal(selectWaybackAvailabilityCapture({
    url: "https://sports.example/athletes/other",
    archived_snapshots: { closest: { available: true, status: "200", timestamp: "20240501010101" } },
  }, canonicalUrl, "2024-06-01T00:00:00Z"), null);
  assert.equal(
    waybackTimegateUrl(canonicalUrl, "2024-06-01T12:34:56Z"),
    `https://web.archive.org/web/20240601123456id_/${canonicalUrl}`
  );
  assert.equal(
    selectWaybackRedirectCapture(
      `https://web.archive.org/web/20240501010101id_/${canonicalUrl}`,
      canonicalUrl,
      "2024-06-01T00:00:00Z"
    )?.timestamp,
    "20240501010101"
  );
  assert.equal(selectWaybackRedirectCapture(
    `https://web.archive.org/web/20240701010101id_/${canonicalUrl}`,
    canonicalUrl,
    "2024-06-01T00:00:00Z"
  ), null);
  assert.equal(selectWaybackRedirectCapture(
    "https://web.archive.org/web/20240501010101id_/https://sports.example/athletes/other",
    canonicalUrl,
    "2024-06-01T00:00:00Z"
  ), null);
  assert.equal(
    canonicalHistoricalArchiveUrl(`${canonicalUrl}?srsltid=tracking&utm_source=google#bio`),
    canonicalUrl
  );
});

test("archived CMS date-created fields preserve the article date instead of the later capture date", () => {
  assert.deepEqual(extractPublishedAt(
    '<div class="itemDateCreated yj-date"><span class="fa fa-clock-o"></span> Nov 26, 2018 </div>',
    "2026-06-16T12:00:00Z",
  ), {
    publishedAt: "2018-11-26T00:00:00.000Z",
    method: "semantic.itemDateCreated",
  });
});

test("stored cutoff-safe evidence is replayed exactly once after an extraction upgrade", () => {
  const record = {
    id: "record-1",
    athlete_name: "Estelle Poret",
    sport: "Aquabike",
    fit_label: "fit" as const,
    evidence_cutoff_at: "2026-05-28T12:00:00Z",
    instagram_handle: null,
  };
  const common = {
    archived_url: "https://web.archive.org/web/20240101000000id_/https://www.lyonfemmes.com/article/estelle-poret",
    canonical_url: "https://www.lyonfemmes.com/article/estelle-poret?utm_source=google",
    content_hash: "ARCHIVE-HASH",
    eligible_before_cutoff: true,
    golden_record_id: record.id,
    historical_as_of: "2024-01-01T00:00:00Z",
    provider: "internet_archive_wayback",
    provider_request_id: "20240101000000",
    retrieval_status: "retrieved",
    title: "Estelle Poret, championne lyonnaise de jet-ski",
  };
  const replay = buildStoredPreparedEvidenceReplayCandidates({
    record,
    extractionVersion: "extract-v2",
    sources: [
      { ...common, metadata: { extraction_version: "extract-v1" } },
      { ...common, canonical_url: "https://current.example/estelle", historical_as_of: "2026-05-29T00:00:00Z", metadata: null },
      { ...common, canonical_url: "https://socialblade.com/instagram/user/estelle", provider: "social_blade_instagram_history", metadata: null },
    ],
  });
  assert.equal(replay.length, 1);
  assert.equal(replay[0]?.url, "https://www.lyonfemmes.com/article/estelle-poret");
  assert.match(replay[0]?.query || "", /stored evidence/);
  assert.deepEqual(replay[0]?.storedCapture, {
    archivedUrl: "https://web.archive.org/web/20240101000000id_/https://www.lyonfemmes.com/article/estelle-poret",
    capturedAt: "2024-01-01T00:00:00.000Z",
    contentHash: "ARCHIVE-HASH",
    timestamp: "20240101000000",
  });
  const alreadyCurrent = buildStoredPreparedEvidenceReplayCandidates({
    record,
    extractionVersion: "extract-v2",
    sources: [{ ...common, metadata: { extraction_version: "extract-v2" } }],
  });
  assert.equal(alreadyCurrent.length, 0);
});

test("Common Crawl fallback selects bounded pre-cutoff captures and extracts the WARC response body", () => {
  const canonicalUrl = "https://sports.example/athletes/jane-doe";
  const collections = selectCommonCrawlCollections([
    { id: "CC-MAIN-2024-18", from: "2024-04-20T00:00:00Z", to: "2024-05-03T23:59:59Z" },
    { id: "CC-MAIN-2024-22", from: "2024-05-17T00:00:00Z", to: "2024-05-31T23:59:59Z" },
    { id: "CC-MAIN-2024-26", from: "2024-06-20T00:00:00Z", to: "2024-07-03T23:59:59Z" },
  ], "2024-06-01T00:00:00Z", 2);
  assert.deepEqual(collections, ["CC-MAIN-2024-22", "CC-MAIN-2024-18"]);

  const capture = selectCommonCrawlCapture([
    { timestamp: "20240501010101", url: canonicalUrl, status: "200", mime: "text/html", filename: "crawl-data/old.warc.gz", offset: "10", length: "100", digest: "OLD" },
    { timestamp: "20240530010101", url: canonicalUrl, status: "200", "mime-detected": "text/html", filename: "crawl-data/latest.warc.gz", offset: "20", length: "200", digest: "LATEST" },
    { timestamp: "20240602010101", url: canonicalUrl, status: "200", mime: "text/html", filename: "crawl-data/future.warc.gz", offset: "30", length: "300", digest: "FUTURE" },
  ], "CC-MAIN-2024-22", canonicalUrl, "2024-06-01T00:00:00Z");
  assert.equal(capture?.timestamp, "20240530010101");
  assert.equal(capture?.digest, "LATEST");
  assert.equal(capture?.warcUrl, "https://data.commoncrawl.org/crawl-data/latest.warc.gz");

  const indexUrl = new URL(commonCrawlIndexUrl("CC-MAIN-2024-22", canonicalUrl));
  assert.equal(indexUrl.hostname, "index.commoncrawl.org");
  assert.equal(indexUrl.searchParams.get("url"), canonicalUrl);
  assert.deepEqual(indexUrl.searchParams.getAll("filter"), ["status:200", "mime:text/html"]);

  const warc = [
    "WARC/1.0",
    "WARC-Type: response",
    "Content-Type: application/http; msgtype=response",
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: text/html; charset=UTF-8",
    "",
    "<html><body>Jane Doe volleyball athlete</body></html>",
    "",
  ].join("\r\n");
  assert.equal(extractCommonCrawlWarcBody(warc), "<html><body>Jane Doe volleyball athlete</body></html>");
  assert.equal(extractCommonCrawlWarcBody(warc.replace("200 OK", "404 Not Found")), null);
});

test("Wikimedia revision fallback retrieves the last cutoff-safe article revision and exposes dated age evidence", () => {
  const canonicalUrl = "https://en.wikipedia.org/wiki/Lola_Gallardo";
  const cutoff = "2026-08-05T12:00:00Z";
  const apiUrl = new URL(wikimediaRevisionApiUrl(canonicalUrl, cutoff)!);
  assert.equal(apiUrl.hostname, "en.wikipedia.org");
  assert.equal(apiUrl.pathname, "/w/api.php");
  assert.equal(apiUrl.searchParams.get("rvdir"), "older");
  assert.equal(apiUrl.searchParams.get("rvstart"), "2026-08-05T12:00:00.000Z");
  assert.equal(apiUrl.searchParams.get("rvlimit"), "1");

  const content = "{{Short description|Spanish footballer}}\n{{Infobox football biography\n| name = Lola Gallardo\n| birth_date = {{Birth date and age|df=yes|1993|6|10}}\n| position = Goalkeeper\n}}";
  const capture = selectWikimediaRevisionCapture({
    query: {
      pages: [{
        revisions: [{
          revid: 1_340_650_263,
          timestamp: "2026-02-26T22:26:03Z",
          sha1: "historicalsha1",
          slots: { main: { content } },
        }],
      }],
    },
  }, canonicalUrl, cutoff);
  assert.equal(capture?.revisionId, 1_340_650_263);
  assert.equal(capture?.capturedAt, "2026-02-26T22:26:03.000Z");
  assert.match(capture?.historicalUrl || "", /oldid=1340650263/);
  assert.match(capture?.content || "", /date of birth: 1993-06-10/);
  assert.equal(normalizeWikipediaWikitext("{{dob|2000|1|2}}"), "date of birth: 2000-01-02");
  assert.equal(
    normalizeWikipediaWikitext("|fecha nacimiento = {{Fecha|24|10|1989|edad}}"),
    "|fecha nacimiento = date of birth: 1989-10-24"
  );

  const prepared = extractPreparedArchivedEvidence({
    record: {
      id: "golden-lola",
      athlete_name: "Lola Gallardo",
      sport: "Football / soccer",
      fit_label: "fit",
      evidence_cutoff_at: cutoff,
    },
    candidate: {
      query: "Lola Gallardo date of birth football",
      title: "Lola Gallardo",
      url: canonicalUrl,
      snippet: "Lola Gallardo is a Spanish football goalkeeper.",
    },
    capture: {
      timestamp: capture!.timestamp,
      capturedAt: capture!.capturedAt,
      originalUrl: canonicalUrl,
      statusCode: "200",
      digest: capture!.sha1,
      mimeType: "text/x-wiki",
      archivedUrl: capture!.historicalUrl,
    },
    html: capture!.content,
  });
  assert.equal(prepared.rejectionReason, null);
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "sport_identity"));
  assert.equal(
    prepared.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility")?.structuredValue.birth_date,
    "1993-06-10"
  );

  assert.equal(selectWikimediaRevisionCapture({
    query: { pages: [{ revisions: [{
      revid: 99,
      timestamp: "2026-08-06T00:00:00Z",
      slots: { main: { content } },
    }] }] },
  }, canonicalUrl, cutoff), null);
});

test("multilingual Wikimedia discovery stays bounded and exact-name attributable", () => {
  assert.match(wikimediaSearchApiUrl({
    language: "es",
    athleteName: "Carlos Gimeno",
    sport: "Cliff diving",
  }) || "", /^https:\/\/es\.wikipedia\.org\/w\/api\.php\?/);
  assert.equal(wikimediaSearchApiUrl({ language: "xx", athleteName: "Carlos Gimeno", sport: "Cliff diving" }), null);
  const candidates = selectWikimediaSearchCandidates({
    language: "es",
    athleteName: "Carlos Gimeno",
    sport: "Cliff diving",
    payload: {
      query: {
        search: [
          { title: "Carlos Gimeno", snippet: "Carlos Gimeno compite en saltos de gran altura." },
          { title: "Carlos Gimeno Valero", snippet: "Tenista español." },
          { title: "Salto de gran altura", snippet: "Competición internacional." },
        ],
      },
    },
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://es.wikipedia.org/wiki/Carlos_Gimeno");

  const exactTitleWithReferenceSnippet = selectWikimediaSearchCandidates({
    language: "es",
    athleteName: "Gaston Reyno",
    sport: "Bare-knuckle boxing",
    payload: {
      query: {
        search: [{
          title: "Gastón Reyno",
          snippet: "Gastón Reyno en Instagram · Gastón Reyno en Sherdog · Gastón Reyno en Tapology",
        }],
      },
    },
  });
  assert.equal(exactTitleWithReferenceSnippet.length, 1);
  assert.equal(exactTitleWithReferenceSnippet[0].url, "https://es.wikipedia.org/wiki/Gast%C3%B3n_Reyno");

  const germanAge = extractPreparedArchivedEvidence({
    record: {
      id: "golden-eddy",
      athlete_name: "Eddy Clerte",
      sport: "BMX racing",
      fit_label: "fit",
      evidence_cutoff_at: "2026-07-07T12:00:00Z",
    },
    candidate: {
      query: "wikimedia:de:Eddy Clerte",
      title: "Eddy Clerté",
      url: "https://de.wikipedia.org/wiki/Eddy_Clert%C3%A9",
      snippet: "Eddy Clerté ist ein BMX-Rennfahrer.",
    },
    capture: {
      timestamp: "20251126141407",
      capturedAt: "2025-11-26T14:14:07Z",
      originalUrl: "https://de.wikipedia.org/wiki/Eddy_Clert%C3%A9",
      statusCode: "200",
      digest: "eddy-revision",
      mimeType: "text/x-wiki",
      archivedUrl: "https://de.wikipedia.org/w/index.php?title=Eddy_Clert%C3%A9&oldid=1",
    },
    html: "Eddy Clerté ist ein französischer BMX-Rennfahrer. Geburtsdatum: 15. August 1998.",
  });
  assert.equal(
    germanAge.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility")?.structuredValue.birth_date,
    "1998-08-15"
  );
});

test("cutoff Wikipedia references expose only trusted exact-athlete profile links", () => {
  const candidates = extractWikimediaExternalProfileCandidates({
    athleteName: "Olivia Macdonald",
    sport: "Beach volleyball",
    wikipediaUrl: "https://de.wikipedia.org/wiki/Olivia_MacDonald",
    wikitext: `
      [https://beach.volleybox.net/de/olivia-macdonald-p28369 Profil]
      [https://arizonawildcats.com/sports/womens-beach-volleyball/roster/olivia-macdonald/8112 Roster]
      [https://www.fivb.com/en/beachvolleyball/rankingwomen Generic ranking]
      [https://facebook.com/oliviamacdonald Social]
    `,
  });
  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    "https://arizonawildcats.com/sports/womens-beach-volleyball/roster/olivia-macdonald/8112",
    "https://beach.volleybox.net/de/olivia-macdonald-p28369",
  ]);
  const gaston = extractWikimediaExternalProfileCandidates({
    athleteName: "Gaston Reyno",
    sport: "Bare-knuckle boxing",
    wikipediaUrl: "https://es.wikipedia.org/wiki/Gast%C3%B3n_Reyno",
    wikitext: "https://www.tapology.com/fightcenter/fighters/48572-gaston-reyno",
  });
  assert.equal(gaston[0]?.url, "https://www.tapology.com/fightcenter/fighters/48572-gaston-reyno");
  const prioritized = dedupeHistoricalSearchCandidates([{
    query: '"Olivia Macdonald" "Beach volleyball" age',
    title: "Olivia Macdonald age",
    url: "https://olympics.com/en/athletes/olivia-macdonald",
    snippet: "Olivia Macdonald beach volleyball date of birth",
    position: 1,
  }, ...candidates], {
    preferAuthoritativeAgeSources: true,
    athleteName: "Olivia Macdonald",
    sport: "Beach volleyball",
  });
  assert.deepEqual(prioritized.slice(0, 2).map((candidate) => candidate.url), candidates.map((candidate) => candidate.url));
});

test("age recovery can add one free-only record while reusing paid discovery", () => {
  const prior = ["a", "b", "c", "d"];
  assert.equal(historicalDiscoveryReplayCoverageMatches({
    mode: "age_recovery",
    requestedRecordIds: [...prior, "e"],
    priorRecordIds: prior,
  }), true);
  assert.equal(historicalDiscoveryReplayCoverageMatches({
    mode: "baseline",
    requestedRecordIds: [...prior, "e"],
    priorRecordIds: prior,
  }), false);
  assert.equal(historicalDiscoveryReplayCoverageMatches({
    mode: "age_recovery",
    requestedRecordIds: [...prior, "e", "f"],
    priorRecordIds: prior,
  }), false);
});

test("two-lane signal recovery reuses paid discovery but refreshes grounded candidates", () => {
  assert.match(HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION, /two-lane-grounded-signal-recovery-v15/);
  assert.deepEqual(HISTORICAL_SIGNAL_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS, [
    HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION,
    "2026-08-15-gate-aware-positive-recovery-v14",
  ]);
  const route = readFileSync(new URL("../src/app/api/research/golden-records/prepare-evidence/route.ts", import.meta.url), "utf8");
  assert.match(route, /HISTORICAL_SIGNAL_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS\.includes/);
  assert.match(route, /reusableCheckpoint\?\.query_plan_version === queryPlanVersion/);
});

test("archive recovery prefers cutoff-safe direct and Common Crawl evidence before Wayback", () => {
  const workflow = readFileSync(new URL("../src/workflows/benchmark-evidence.ts", import.meta.url), "utf8");
  const direct = workflow.indexOf("const datedArticle = await retrieveDirectDatedArticleEvidenceCandidate");
  const commonCrawl = workflow.indexOf("const commonCrawl = await retrieveCommonCrawlEvidenceCandidate", direct);
  const wayback = workflow.indexOf("let waybackRateLimited", commonCrawl);
  assert.ok(direct > 0 && commonCrawl > direct && wayback > commonCrawl);
  assert.match(workflow, /extractPreparedDatedArticleEvidence/);
  assert.match(workflow, /isPublicHttpUrl\(url\.toString\(\)\)/);
  assert.match(workflow, /wayback_rate_limited_after_direct_and_common_crawl_miss/);
  assert.match(HISTORICAL_ARCHIVE_PROVIDER_VERSION, /direct-common-crawl-first-v17/);
  assert.equal(isPublicHttpUrl("https://example.com/athlete"), true);
  assert.equal(isPublicHttpUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isPublicHttpUrl("http://192.168.1.12/private"), false);
  assert.equal(isPublicHttpUrl("http://[::1]/private"), false);
});

test("archived evidence extraction requires exact identity and sport and preserves dated age provenance", () => {
  const record = {
    id: "golden-jane",
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    fit_label: "fit" as const,
    evidence_cutoff_at: "2024-06-01T23:59:59Z",
  };
  const candidate = {
    query: '"Jane Doe" "Volleyball" athlete profile before:2024-06-01',
    title: "Jane Doe athlete profile",
    url: "https://volleyball.example/players/jane-doe",
    snippet: "Jane Doe is a volleyball player.",
    position: 1,
  };
  const capture = {
    timestamp: "20240501010101",
    capturedAt: "2024-05-01T01:01:01.000Z",
    originalUrl: candidate.url,
    statusCode: "200",
    digest: "ABC123",
    mimeType: "text/html",
    archivedUrl: `https://web.archive.org/web/20240501010101id_/${candidate.url}`,
  };
  const html = `<!doctype html><html><head><title>Jane Doe | Volleyball Roster</title><script type="application/ld+json">{"datePublished":"2023-09-01"}</script></head><body><main><h1>Jane Doe</h1><p>Jane Doe was born January 15, 2000 and is a volleyball outside hitter. Jane Doe, a nationally ranked rookie, won a conference championship and is a content creator with 100,000 Instagram followers.</p></main></body></html>`;
  const prepared = extractPreparedArchivedEvidence({ record, candidate, capture, html });

  assert.equal(prepared.rejectionReason, null);
  assert.equal(prepared.evidence?.historicalAsOf, capture.capturedAt);
  assert.equal(prepared.evidence?.publishedAt, "2023-09-01T00:00:00.000Z");
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "sport_identity"));
  const age = prepared.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(age?.structuredValue.birth_date, "2000-01-15");
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "athletic_momentum"));
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const liveAgeOnOlderProfile = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Catarina Guimaraes", sport: "Track & Field", evidence_cutoff_at: "2025-06-30T23:59:59Z" },
    candidate: { ...candidate, title: "Team USA | Catarina Guimaraes", url: "https://www.teamusa.com/profiles/catarina-guimaraes" },
    capture: { ...capture, capturedAt: "2025-06-17T20:19:27.000Z", originalUrl: "https://www.teamusa.com/profiles/catarina-guimaraes" },
    html: '<html><head><title>Team USA | Catarina Guimaraes</title><script type="application/ld+json">{"datePublished":"2023-04-27"}</script></head><body><main>Catarina Guimaraes is a Team USA track and field athlete. Athlete Bio Height 5\'0" Age 21 Hometown Cranford, NJ.</main></body></html>',
  });
  const observedAge = liveAgeOnOlderProfile.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(observedAge?.structuredValue.precision, "stated_age");
  assert.equal(observedAge?.effectiveAt, "2025-06-17T20:19:27.000Z");
  assert.equal(observedAge?.structuredValue.age_as_of, "2025-06-17T20:19:27.000Z");

  const immutableArticleAge = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Maks Płuciennik", sport: "BMX", evidence_cutoff_at: "2026-06-16T12:00:00Z" },
    candidate: { ...candidate, title: "FAT FAVOURITES with Maks Płuciennik", url: "https://fatbmx.example/maks-pluciennik" },
    capture: { ...capture, capturedAt: "2023-02-09T02:12:07.000Z", originalUrl: "https://fatbmx.example/maks-pluciennik" },
    html: '<html><head><title>FAT FAVOURITES with Maks Płuciennik</title><script type="application/ld+json">{"@type":"Article","datePublished":"2018-11-26T14:53:17Z","dateModified":"2018-11-26T14:53:17Z","articleBody":"Name: Maks Płuciennik Age: 19 BMX rider."}</script></head><body><main>Maks Płuciennik is a BMX rider. Name: Maks Płuciennik Age: 19.</main></body></html>',
  });
  const immutableAge = immutableArticleAge.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(immutableAge?.effectiveAt, "2018-11-26T14:53:17.000Z");

  const wrongPerson = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Janet Doe | Volleyball</title><body>Janet Doe plays volleyball.</body></html>",
  });
  assert.equal(wrongPerson.evidence, null);
  assert.equal(wrongPerson.rejectionReason, "archived_page_does_not_name_exact_athlete");

  const separatedNameTokens = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane volleyball roster</title><body>Jane is a volleyball athlete coached by John Doe.</body></html>",
  });
  assert.equal(separatedNameTokens.evidence, null);
  assert.equal(separatedNameTokens.rejectionReason, "archived_page_does_not_name_exact_athlete");

  const wrongSport = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane Doe</title><body>Jane Doe competes professionally in tennis.</body></html>",
  });
  assert.equal(wrongSport.evidence, null);
  assert.equal(wrongSport.rejectionReason, "archived_page_does_not_support_requested_sport");

  const navigationOnlySignals = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane Doe volleyball profile</title><body><nav>Skip to main content Rankings Record Book Instagram YouTube</nav><main><h1>Jane Doe</h1><p>Jane Doe is a volleyball athlete with a public player biography and team profile.</p></main></body></html>",
  });
  assert.equal(navigationOnlySignals.rejectionReason, null);
  assert.ok(!navigationOnlySignals.evidence?.claims.some((claim) => claim.claimType === "athletic_momentum"));
  assert.ok(!navigationOnlySignals.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const teammateSignals = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane Doe volleyball profile</title><body><main><p>Jane Doe is a volleyball athlete. Teammate Riley Roe won the national championship and has 120,000 followers.</p></main></body></html>",
  });
  assert.equal(teammateSignals.rejectionReason, null);
  assert.ok(!teammateSignals.evidence?.claims.some((claim) => claim.claimType === "athletic_momentum"));
  assert.ok(!teammateSignals.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const pronounSignals = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane Doe volleyball profile</title><body><main><p>Jane Doe is a volleyball athlete. She won the national championship and has 120,000 followers.</p></main></body></html>",
  });
  assert.ok(pronounSignals.evidence?.claims.some((claim) => claim.claimType === "athletic_momentum"));
  assert.ok(pronounSignals.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const lateLocalizedAudience = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Tessa Thyssen", sport: "Surfing", evidence_cutoff_at: "2026-07-07T12:00:00Z" },
    candidate: { ...candidate, title: "Tessa Thyssen : entretien", url: "https://surf.example/tessa-thyssen" },
    capture: { ...capture, capturedAt: "2026-02-11T03:48:13.000Z", originalUrl: "https://surf.example/tessa-thyssen" },
    html: `<html><title>Tessa Thyssen : entretien</title><body><main><p>Tessa Thyssen est une surfeuse professionnelle.</p>${"<p>Navigation magazine.</p>".repeat(80)}<p>J&rsquo;explique mon projet et ils suivent mes 12 800 abonnés.</p></main></body></html>`,
  });
  assert.ok(lateLocalizedAudience.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const athleteFeatureUnderGenericPublisherTitle = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Astrid Madrigal", sport: "Motorsports" },
    candidate: { ...candidate, title: "WorldSBK", url: "https://worldsbk.example/astrid-madrigal" },
    capture: { ...capture, originalUrl: "https://worldsbk.example/astrid-madrigal" },
    html: '<html><head><title>WorldSBK</title></head><body><main><h1>HER STORY: meet Astrid Madrigal – “I’ve helped many girls fulfil their dream”</h1><p>Astrid Madrigal is a WorldWCR motorcycle racing rider.</p></main></body></html>',
  });
  assert.match(athleteFeatureUnderGenericPublisherTitle.evidence?.title || "", /HER STORY: meet Astrid Madrigal/);
  assert.ok(athleteFeatureUnderGenericPublisherTitle.evidence?.claims.some(
    (claim) => claim.claimType === "creator_behavior_signal",
  ));

  const athleteFeatureUnderOpenGraphTitle = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Astrid Madrigal", sport: "Motorsports" },
    candidate: { ...candidate, title: "WorldSBK", url: "https://worldsbk.example/astrid-madrigal" },
    capture: { ...capture, originalUrl: "https://worldsbk.example/astrid-madrigal" },
    html: '<html><head><title>WorldSBK</title><meta property="og:title" content="HER STORY: meet Astrid Madrigal – athlete interview"></head><body><main><h1>News</h1><h2>HER STORY: meet Astrid Madrigal – athlete interview</h2><p>Astrid Madrigal is a WorldWCR motorcycle racing rider.</p></main></body></html>',
  });
  assert.match(athleteFeatureUnderOpenGraphTitle.evidence?.title || "", /HER STORY: meet Astrid Madrigal/);
  assert.ok(athleteFeatureUnderOpenGraphTitle.evidence?.claims.some(
    (claim) => claim.claimType === "creator_behavior_signal",
  ));

  const officialCompactDob = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Nick Ponzio", sport: "Track & Field" },
    candidate: { ...candidate, title: "World Athletics shot put list", url: "https://worldathletics.org/records/shot-put" },
    capture: { ...capture, originalUrl: "https://worldathletics.org/records/shot-put" },
    html: "<html><title>World Athletics shot put list</title><body><main>Nick Ponzio 04 JAN 1995 ITA Shot Put Track and Field senior ranking.</main></body></html>",
  });
  const officialAge = officialCompactDob.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(officialAge?.structuredValue.birth_date, "1995-01-04");

  const famousBirthdaysDob = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Boyd Hilder", sport: "BMX" },
    candidate: { ...candidate, title: "Boyd Hilder - Age, Family, Bio", url: "https://www.famousbirthdays.com/people/boyd-hilder.html" },
    capture: { ...capture, capturedAt: "2023-02-03T19:44:35.000Z", originalUrl: "https://www.famousbirthdays.com/people/boyd-hilder.html" },
    html: "<html><title>Boyd Hilder - Age, Family, Bio</title><body><main>Boyd Hilder BMX Rider Birthday November Nov 30 , 1995 Birthplace Australia Age 27 years old. Professional BMX rider and winner with more than 80,000 followers.</main></body></html>",
  });
  const famousBirthdaysAge = famousBirthdaysDob.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(famousBirthdaysAge?.structuredValue.birth_date, "1995-11-30");
  assert.equal(famousBirthdaysAge?.structuredValue.birth_year, 1995);

  const historicalAgeMention = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Rita Arnaus", sport: "Kitesurfing" },
    candidate: { ...candidate, title: "Rita Arnaus profile", url: "https://example.com/rita-arnaus" },
    capture: { ...capture, originalUrl: "https://example.com/rita-arnaus" },
    html: "<html><title>Rita Arnaus kitesurfing profile</title><body><main>Rita Arnaus is a professional kitesurfing athlete who began kitesurfing aged 15 and later won a championship.</main></body></html>",
  });
  assert.ok(!historicalAgeMention.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"));

  const teammateAgeMention = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Lola Gallardo", sport: "Soccer" },
    candidate: { ...candidate, title: "Ludmila Silva - Age, Family, Bio", url: "https://www.famousbirthdays.com/people/ludmila-silva.html" },
    capture: { ...capture, originalUrl: "https://www.famousbirthdays.com/people/ludmila-silva.html" },
    html: "<html><title>Ludmila Silva - Age, Family, Bio</title><body><main>Ludmila Silva is a soccer player. She and Lola Gallardo played together for Atletico Madrid. Popularity Most Popular First Name Ludmila Soccer Player Ludmila Silva Is A Member Of 31 Year Olds.</main></body></html>",
  });
  assert.equal(teammateAgeMention.rejectionReason, null);
  assert.ok(!teammateAgeMention.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"));

  const siblingAgeMention = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Gisele Thompson", sport: "Soccer" },
    candidate: { ...candidate, title: "Gisele Thompson forges her own path", url: "https://news.example/gisele-thompson" },
    capture: { ...capture, originalUrl: "https://news.example/gisele-thompson" },
    html: "<html><title>Gisele Thompson forges her own path</title><body><main>Sisters Alyssa and Gisele Thompson have played soccer together. Alyssa turned pro in 2023 at age 18 when she signed with Angel City, and Gisele followed.</main></body></html>",
  });
  assert.equal(siblingAgeMention.rejectionReason, null);
  assert.ok(!siblingAgeMention.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"));
});

test("direct dated articles admit only tightly timestamped, attributable pre-cutoff evidence", () => {
  const record = {
    id: "golden-daryn",
    athlete_name: "Daryn Harris",
    sport: "Boxing",
    fit_label: "fit" as const,
    evidence_cutoff_at: "2026-05-11T23:59:59Z",
  };
  const url = "https://sports.example/daryn-harris-undercard";
  const candidate = {
    query: '"Daryn Harris" boxing Instagram followers',
    title: "Daryn Harris undercard",
    url,
    snippet: "Daryn Harris is a boxer and kickboxer.",
  };
  const article = (overrides: { modified?: string; body?: string; includeModified?: boolean } = {}) => {
    const modified = overrides.modified || "2025-08-30T00:29:02Z";
    const body = overrides.body || "Further down the card is Carla Jade vs. Daryn Harris. Jade is the champion. Harris is a boxer and kickboxer with over 76.7K followers on Instagram.";
    const metadata = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      url,
      headline: "Daryn Harris undercard",
      datePublished: "2025-08-29T21:35:35Z",
      ...(overrides.includeModified === false ? {} : { dateModified: modified }),
    };
    return `<html><head><link href="${url}" rel="canonical"><script type="application/ld+json">${JSON.stringify(metadata)}</script></head><body><main><h3>Daryn Harris boxing profile</h3><p>${body}</p></main></body></html>`;
  };

  const accepted = extractPreparedDatedArticleEvidence({ record, candidate, html: article() });
  assert.equal(accepted.rejectionReason, null);
  assert.equal(accepted.evidence?.archiveProvider, "direct_dated_article");
  assert.equal(accepted.evidence?.historicalAsOf, "2025-08-30T00:29:02.000Z");
  assert.ok(accepted.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const missingModified = extractPreparedDatedArticleEvidence({
    record, candidate, html: article({ includeModified: false }),
  });
  assert.equal(missingModified.evidence, null);
  assert.equal(missingModified.rejectionReason, "dated_article_missing_cutoff_safe_newsarticle_dates");

  const afterCutoff = extractPreparedDatedArticleEvidence({
    record, candidate, html: article({ modified: "2026-05-12T00:00:00Z" }),
  });
  assert.equal(afterCutoff.evidence, null);
  assert.equal(afterCutoff.rejectionReason, "dated_article_missing_cutoff_safe_newsarticle_dates");

  const lateRewrite = extractPreparedDatedArticleEvidence({
    record, candidate, html: article({ modified: "2025-09-10T00:00:00Z" }),
  });
  assert.equal(lateRewrite.evidence, null);
  assert.equal(lateRewrite.rejectionReason, "dated_article_missing_cutoff_safe_newsarticle_dates");

  const wrongPersonAudience = extractPreparedDatedArticleEvidence({
    record,
    candidate,
    html: article({ body: "Daryn Harris is a boxer and kickboxer. Carla Jade has over 76.7K followers on Instagram." }),
  });
  assert.equal(wrongPersonAudience.rejectionReason, null);
  assert.ok(!wrongPersonAudience.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));
});

test("archived Instagram handles require athlete attribution and reject publisher footer accounts", () => {
  assert.equal(extractAttributedInstagramHandle({
    athleteName: "Tessa Thyssen",
    title: "Connecté avec Tessa Thyssen",
    html: '<main>Tessa Thyssen is a professional surfing athlete. Her latest photo was posted on Instagram (<a href="https://www.instagram.com/tessathyssen/">@tessathyssen</a>).</main>',
  })?.handle, "tessathyssen");
  assert.equal(extractAttributedInstagramHandle({
    athleteName: "Crystal Pittman",
    title: "Crystal Pittman fighter profile",
    html: '<main>Crystal Pittman is a professional combat sports athlete. A post shared by Crystal Pittman (<a href="https://instagram.com/the_rugged_beauty/">@the_rugged_beauty</a>).</main>',
  })?.handle, "the_rugged_beauty");
  assert.equal(extractAttributedInstagramHandle({
    athleteName: "Catarina Guimaraes",
    title: "Catarina Guimaraes | Track & Field",
    html: '<main>Catarina Guimaraes is a Team USA track and field athlete. <a href="https://instagram.com/catarinaguimaraes04/">Instagram</a></main>',
  })?.handle, "catarinaguimaraes04");
  assert.equal(extractAttributedInstagramHandle({
    athleteName: "Jane Doe",
    title: "Jane Doe volleyball profile",
    html: '<main>Jane Doe is a volleyball athlete.</main><footer>Follow the publisher on Instagram <a href="https://instagram.com/volleyball_news/">@volleyball_news</a></footer>',
  }), null);
  assert.equal(extractAttributedInstagramHandle({
    athleteName: "Carlos Gimeno",
    title: "High Diver on the Rise: Spain's Carlos Gimeno",
    html: '<main><h1>High Diver on the Rise: Spain\'s Carlos Gimeno</h1><p>Carlos Gimeno competes in cliff diving.</p></main><footer>Follow World Aquatics on Instagram <a href="https://instagram.com/world_aquatics/">Instagram</a></footer>',
  }), null);

  const record = {
    id: "golden-tessa",
    athlete_name: "Tessa Thyssen",
    sport: "Surfing",
    fit_label: "fit" as const,
    evidence_cutoff_at: "2026-07-07T12:00:00Z",
  };
  const candidate = {
    query: '"Tessa Thyssen" Surfing Instagram before:2026-07-07',
    title: "Connecté avec Tessa Thyssen",
    url: "https://example.test/tessa-thyssen",
    snippet: "Tessa Thyssen shares her latest Instagram post.",
  };
  const capture = {
    timestamp: "20250215035606",
    capturedAt: "2025-02-15T03:56:06.000Z",
    originalUrl: candidate.url,
    statusCode: "200",
    digest: "TESSA123",
    mimeType: "text/html",
    archivedUrl: `https://web.archive.org/web/20250215035606id_/${candidate.url}`,
  };
  const prepared = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: '<html><head><title>Connecté avec Tessa Thyssen</title></head><body><main><p>Tessa Thyssen is a professional surfing athlete.</p><p>Her latest photo was posted on Instagram (<a href="https://instagram.com/tessathyssen/">@tessathyssen</a>).</p></main></body></html>',
  });
  const profile = prepared.evidence?.claims.find((claim) => claim.claimType === "athlete_profile");
  assert.equal(profile?.structuredValue.platform, "instagram");
  assert.equal(profile?.structuredValue.handle, "tessathyssen");
});

test("age evidence revalidation preserves athlete profiles without inheriting another person's age", () => {
  const norma = validatePreparedAgeEvidenceForSource({
    athleteName: "Norma Dumont",
    title: "Norma Dumont | UFC",
    domain: "ufc.com",
    observedAt: new Date("2026-04-19T19:32:11Z"),
    text: "Norma Dumont | UFC\nLearn more about Norma Dumont's UFC history. Bio Fighter Facts Status Active Place of Birth Belo Horizonte, Brazil Age 35 Height 67.00",
  });
  assert.equal(norma.attributableAge?.parsed.age, 35);

  const kerstin = validatePreparedAgeEvidenceForSource({
    athleteName: "Kerstin Casparij",
    title: "Kerstin Casparij - Player profile",
    domain: "soccerdonna.de",
    observedAt: new Date("2024-01-26T03:05:07Z"),
    text: `Kerstin Casparij - Player profile\n${"Profile navigation ".repeat(20)} Kerstin Casparij Date of birth: 19.08.2000 Place of birth: Alphen aan den Rijn Age: 23`,
  });
  assert.equal(kerstin.attributableAge?.parsed.precision, "birth_date");

  const mondo = validatePreparedAgeEvidenceForSource({
    athleteName: "Mondo Duplantis",
    title: "Mondo Duplantis bio: Age, height, hometown, family, fun facts",
    domain: "nbcolympics.com",
    observedAt: new Date("2025-08-06T09:22:47Z"),
    text: `Mondo Duplantis bio\n${"Career accolades and records. ".repeat(10)} Mondo Duplantis has collected many accolades. At just 24 years old, the Swedish pole vaulter is a world champion.`,
  });
  assert.equal(mondo.attributableAge?.parsed.age, 24);

  const frenchAgeBeforeName = validatePreparedAgeEvidenceForSource({
    athleteName: "Estelle Poret",
    title: "Estelle Poret, championne lyonnaise de jet-ski",
    domain: "lyonfemmes.com",
    observedAt: new Date("2023-09-28T20:24:58Z"),
    text: "Estelle Poret, championne lyonnaise de jet-ski. A 26 ans, Estelle Poret porte une double casquette, entrepreneuse et sportive de haut-niveau.",
  });
  assert.equal(frenchAgeBeforeName.attributableAge?.parsed.age, 26);
  assert.equal(frenchAgeBeforeName.attributableAge?.parsed.precision, "stated_age");

  const sibling = validatePreparedAgeEvidenceForSource({
    athleteName: "Gisele Thompson",
    title: "Gisele Thompson forges her own path",
    domain: "latimes.com",
    observedAt: new Date("2026-03-23T05:00:55Z"),
    text: "Gisele Thompson forges her own path\nSisters Alyssa and Gisele Thompson have played soccer together. Alyssa turned pro in 2023 at age 18 when she signed with Angel City, and Gisele followed.",
  });
  assert.equal(sibling.attributableAge, null);

  const childhood = validatePreparedAgeEvidenceForSource({
    athleteName: "Margo Hayes",
    title: "Margo Hayes Makes History",
    domain: "exploreinspired.com",
    observedAt: new Date("2026-03-07T02:43:39Z"),
    text: "Margo Hayes Makes History\nMargo Hayes has been climbing since she was 10 years old and making waves ever since.",
  });
  assert.equal(childhood.attributableAge, null);

  const childhoodMove = validatePreparedAgeEvidenceForSource({
    athleteName: "Olivia Macdonald",
    title: "Olivia Macdonald is halfway around the world making a name for herself",
    domain: "arizona.edu",
    observedAt: new Date("2026-01-25T09:55:20Z"),
    text: "Olivia Macdonald is a beach volleyball athlete. Macdonald moved out of the house at 11 years old to attend boarding school.",
  });
  assert.equal(childhoodMove.attributableAge, null);

  const ordinalBirthDate = validatePreparedAgeEvidenceForSource({
    athleteName: "Crystal Pittman",
    title: "Crystal Pittman fighter profile",
    domain: "tapology.com",
    observedAt: new Date("2026-07-16T07:15:36Z"),
    text: "Crystal Pittman is a combat sports fighter. Born: Wednesday 21st of May 1986.",
  });
  assert.equal(ordinalBirthDate.attributableAge?.parsed.precision, "birth_date");
  assert.equal(ordinalBirthDate.attributableAge?.parsed.birthYear, 1986);

  const frenchBirthDate = validatePreparedAgeEvidenceForSource({
    athleteName: "Eddy Clerte",
    title: "SUNN x Eddy Clerte",
    domain: "sunn.fr",
    observedAt: new Date("2026-07-01T00:00:00Z"),
    text: "Eddy Clerte est un pilote de BMX. Eddy Clerte, né le 15 août 1998, est un passionné de BMX.",
  });
  assert.equal(frenchBirthDate.attributableAge?.parsed.precision, "birth_date");
  assert.equal(frenchBirthDate.attributableAge?.parsed.birthYear, 1998);

  const spanishParentheticalBirthDate = validatePreparedAgeEvidenceForSource({
    athleteName: "Carlos Gimeno",
    title: "Carlos Gimeno salta desde una plataforma para adultos",
    domain: "as.com",
    observedAt: new Date("2025-07-23T04:02:01Z"),
    text: "Carlos Gimeno salta desde una plataforma para adultos. Carlos Gimeno (Gran Canaria, 24-10-1989) es un deportista profesional de saltos de gran altura.",
  });
  assert.equal(spanishParentheticalBirthDate.officialCompactBirthDate?.birthDate, "1989-10-24");
  const ambiguousParentheticalBirthDate = validatePreparedAgeEvidenceForSource({
    athleteName: "Carlos Gimeno",
    title: "Carlos Gimeno profile",
    domain: "example.com",
    observedAt: new Date("2025-07-23T04:02:01Z"),
    text: "Carlos Gimeno (Gran Canaria, 10-11-1989) is a cliff diving athlete.",
  });
  assert.equal(ambiguousParentheticalBirthDate.officialCompactBirthDate, null);

  const editorialPronounAge = validatePreparedAgeEvidenceForSource({
    athleteName: "Lola Gallardo",
    title: "Coming Out Day: full interviews",
    domain: "espn.com",
    observedAt: new Date("2025-07-22T09:36:54Z"),
    text: "Spain women's national team goalkeeper Lola Gallardo [she/her], 28, has spent the bulk of her club career with Atletico Madrid.",
  });
  assert.deepEqual(editorialPronounAge.attributableAge?.parsed, {
    age: 28,
    birthYear: null,
    precision: "stated_age",
  });
});

test("historical discovery is tightly bounded and deduplicates URLs and domains", () => {
  const queries = buildHistoricalEvidenceQueries({
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
  });
  assert.equal(queries.length, 3);
  assert.ok(queries.every((query) => query.includes("before:2024-06-01")));
  assert.ok(queries.every((query) => query.includes("-site:instagram.com")));
  const broadSportQueries = buildHistoricalEvidenceQueries({
    athlete_name: "Payton Talbott",
    sport: "Combat Sports",
    evidence_cutoff_at: "2025-01-01T00:00:00Z",
  });
  assert.ok(broadSportQueries.every((query) => query.includes("(MMA OR UFC OR boxing OR boxe OR kickboxing OR fighter OR combattant)")));
  assert.ok(broadSportQueries.every((query) => !query.includes('"Combat Sports"')));
  assert.ok(queries[1].includes('("date of birth" OR birthday OR born OR age)'));
  const ageRecovery = buildHistoricalAgeRecoveryQueries({
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
    instagram_handle: "jane.volley",
  });
  assert.equal(ageRecovery.length, 4);
  assert.ok(ageRecovery[0].startsWith('"Jane Doe" ("date of birth"'));
  assert.ok(!ageRecovery[0].includes('"Volleyball"'));
  assert.ok(ageRecovery.every((query) => /birth|born|age/i.test(query)));
  assert.ok(ageRecovery.every((query) => query.includes("before:2024-06-01")));
  assert.ok(ageRecovery.some((query) => query.includes("site:wikipedia.org")));
  assert.ok(ageRecovery.some((query) => query.includes("site:volleyballworld.com")));
  assert.ok(ageRecovery.some((query) => query.includes('"@jane.volley"')));
  const combatAgeRecovery = buildHistoricalAgeRecoveryQueries({
    athlete_name: "Crystal Fighter",
    sport: "Combat Sports",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
    instagram_handle: null,
  });
  assert.ok(combatAgeRecovery.some((query) => query.includes("site:myfloridalicense.com")));
  const signalRecovery = buildHistoricalSignalRecoveryQueries({
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
  });
  assert.equal(signalRecovery.length, 4);
  assert.ok(signalRecovery.every((query) => query.includes("before:2024-06-01")));
  assert.ok(signalRecovery.every((query) => query.startsWith('"Jane Doe"')));
  assert.ok(signalRecovery.some((query) => /content creator|followers|vlogs/.test(query)));
  assert.ok(signalRecovery.some((query) => /socialblade|hypeauditor|favikon|socialauditor/.test(query)));
  assert.ok(signalRecovery.some((query) => /abonnés|seguidores/.test(query)));
  assert.ok(signalRecovery.some((query) => /date of birth|birthdate|birthday/.test(query)));
  assert.ok(signalRecovery.some((query) => /result|ranking|championship|podium/.test(query)));
  assert.ok(signalRecovery.every((query) => !/onlyfans/i.test(query)), "development signal recovery must not search for the labeled outcome");
  assert.equal(normalizeEvidencePreparationBudget(100), 1);
  assert.equal(normalizeEvidencePreparationBudget(0), 0.5);
  assert.equal(normalizeEvidencePreparationBudget(undefined), 0.75);
  const deduped = dedupeHistoricalSearchCandidates([
    { query: "q", title: "A", url: "https://one.example/a", snippet: "", position: 1 },
    { query: "q", title: "A duplicate", url: "http://one.example/a/", snippet: "", position: 2 },
    { query: "q", title: "B", url: "https://one.example/b", snippet: "", position: 3 },
    { query: "q", title: "C over domain cap", url: "https://one.example/c", snippet: "", position: 4 },
    { query: "q", title: "Local", url: "http://localhost/private", snippet: "", position: 5 },
    { query: "q", title: "Social", url: "https://www.instagram.com/jane", snippet: "", position: 5 },
    { query: "q", title: "D", url: "https://two.example/d", snippet: "", position: 6 },
  ]);
  assert.deepEqual(deduped.map((item) => item.title), ["A", "B", "D"]);
  const agePrioritized = dedupeHistoricalSearchCandidates([
    { query: "q", title: "Generic profile", url: "https://athletes.example/nick", snippet: "", position: 1 },
    { query: "q", title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Nick_Ponzio", snippet: "", position: 5 },
    { query: "q", title: "World Athletics", url: "https://worldathletics.org/athletes/nick-ponzio", snippet: "", position: 4 },
  ], { preferAuthoritativeAgeSources: true });
  assert.deepEqual(agePrioritized.slice(0, 2).map((item) => item.title), ["World Athletics", "Wikipedia"]);
  const relevantAgeCandidates = dedupeHistoricalSearchCandidates([
    { query: "q", title: "Carlos Gimeno Valero tennis profile", url: "https://espn.com/tennis/carlos-gimeno-valero", snippet: "Carlos Gimeno Valero plays tennis. Date of birth 2001.", position: 1 },
    { query: "q", title: "Carlos Gimeno cliff diver profile", url: "https://redbull.com/athlete/carlos-gimeno", snippet: "Carlos Gimeno competes in cliff diving. Date of birth 24 October 1989.", position: 4 },
  ], { preferAuthoritativeAgeSources: true, athleteName: "Carlos Gimeno", sport: "Cliff Diving" });
  assert.equal(relevantAgeCandidates[0]?.title, "Carlos Gimeno cliff diver profile");
  const archivedSocialCandidate = dedupeHistoricalSearchCandidates([
    { query: "q", title: "Instagram profile", url: "https://www.instagram.com/jane", snippet: "", position: 1 },
  ], { allowSocialProfiles: true });
  assert.equal(archivedSocialCandidate.length, 1);
});

test("historical signal recovery uses a known cutoff-safe Instagram handle without increasing query volume", () => {
  const queries = buildHistoricalSignalRecoveryQueries({
    athlete_name: "Example Athlete",
    sport: "Surfing",
    evidence_cutoff_at: "2026-08-05T12:00:00.000Z",
    instagram_handle: "@example.athlete",
  });
  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => query.startsWith('"Example Athlete"')));
  assert.match(queries[0], /date of birth/);
  assert.match(queries[1], /result OR results OR ranking/);
  assert.match(queries[2], /abonnés/);
  assert.match(queries[3], /"@example\.athlete"/);
  assert.match(queries[3], /site:socialblade\.com/);
  assert.match(queries[3], /site:socialauditor\.io/);
  assert.match(queries[3], /followers/);
  assert.match(queries[3], /content creator/);
});

test("historical signal recovery searches multilingual sport aliases instead of brittle exact labels", () => {
  const surfing = buildHistoricalSignalRecoveryQueries({
    athlete_name: "Tessa Thyssen",
    sport: "Surfing",
    evidence_cutoff_at: "2026-07-07T12:00:00.000Z",
    instagram_handle: "@tessathyssen",
  });
  assert.match(surfing[1], /surf OR surfing OR surfer OR surfeur OR surfeuse OR surfista/);
  assert.doesNotMatch(surfing[3], /"Surfing"/);
  assert.match(surfing[3], /posté OR poster OR publier OR photos/);
  assert.match(surfing[3], /-site:instagram\.com/);
  assert.match(surfing[3], /-site:youtube\.com/);
  const athletics = buildHistoricalSignalRecoveryQueries({
    athlete_name: "Catarina Guimaraes",
    sport: "Track & Field",
    evidence_cutoff_at: "2025-08-21T12:00:00.000Z",
    instagram_handle: null,
  });
  assert.match(athletics[3], /athlétisme OR atletismo/);
  const freediving = buildHistoricalSignalRecoveryQueries({
    athlete_name: "Harry McCahill",
    sport: "Freediving",
    evidence_cutoff_at: "2025-01-01T12:00:00.000Z",
    instagram_handle: null,
  });
  assert.match(freediving[3], /freediving OR freediver OR apnea OR apnée/);
});

test("grounded deep signal discovery accepts only consulted exact-athlete sport sources", () => {
  const records = [{
    id: "tessa",
    athlete_name: "Tessa Thyssen",
    sport: "Surfing",
    evidence_cutoff_at: "2026-07-07T12:00:00.000Z",
  }];
  const riderPost = "https://www.theriderpost.com/disciplines/water/surf/tessa-thyssen-surfe-fesses/";
  const citedProfile = "https://example.org/profiles/tessa-thyssen";
  const candidates = groundedHistoricalSignalDiscoveryCandidates({
    records,
    proposed: [{
      athlete_name: "Tessa Thyssen",
      source_urls: [
        riderPost,
        citedProfile,
        "https://not-consulted.example/surf/tessa-thyssen",
        "https://youtube.com/watch?v=tessa",
        "https://example.com/surf/someone-else",
        "https://example.com/tennis/tessa-thyssen",
      ],
    }],
    consultedSources: [
      { url: riderPost, title: "Tessa Thyssen : Surfer, c'est montrer ses fesses" },
      { url: citedProfile, title: "Athlete profile", content: "Tessa Thyssen is a professional surfing athlete and content creator." },
      { url: "https://youtube.com/watch?v=tessa", title: "Tessa Thyssen surfing interview" },
      { url: "https://example.com/surf/someone-else", title: "Someone Else surfing interview" },
      { url: "https://example.com/tennis/tessa-thyssen", title: "Tessa Thyssen tennis profile" },
    ],
  });
  assert.deepEqual(candidates.tessa?.map((candidate) => candidate.url), [riderPost, citedProfile]);
});

test("grounded age discovery can defer thin citation sport proof to the strict archive extractor", () => {
  const interview = "https://example.org/interviews/sara-fruncillo";
  const strict = groundedHistoricalSignalDiscoveryCandidates({
    records: [{
      id: "sara", athlete_name: "Sara Fruncillo", sport: "Motorsports",
      evidence_cutoff_at: "2025-12-10T12:00:00.000Z",
    }],
    proposed: [{ athlete_name: "Sara Fruncillo", source_urls: [interview] }],
    consultedSources: [{ url: interview, title: "Intervista a Sara Fruncillo" }],
  });
  assert.deepEqual(strict.sara, []);
  const ageRecovery = groundedHistoricalSignalDiscoveryCandidates({
    records: [{
      id: "sara", athlete_name: "Sara Fruncillo", sport: "Motorsports",
      evidence_cutoff_at: "2025-12-10T12:00:00.000Z",
    }],
    proposed: [{ athlete_name: "Sara Fruncillo", source_urls: [interview] }],
    consultedSources: [{ url: interview, title: "Intervista a Sara Fruncillo" }],
    requireSportInDiscoveryMetadata: false,
  });
  assert.deepEqual(ageRecovery.sara?.map((candidate) => candidate.url), [interview]);
});

test("generated material signals require explicit athlete-relevant language", () => {
  assert.equal(preparedEvidenceSignalSupported("audience_signal", "Skip to main content Instagram YouTube"), false);
  assert.equal(preparedEvidenceSignalSupported("audience_signal", "The athlete is a content creator with 120,000 followers."), true);
  assert.equal(preparedEvidenceSignalSupported("audience_signal", "La surfeuse compte 12 800 abonnés."), true);
  assert.match(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Paula Novotna",
    claimType: "audience_signal",
    sourceExcerpt: "Paula Novotna shared the production with her profile, which gathers around 150,000 fans worldwide.",
  }) || "", /150,000 fans/);
  assert.match(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Tessa Thyssen",
    claimType: "audience_signal",
    sourceExcerpt: "Tessa Thyssen : entretien. Je valorise mes partenaires et ils suivent mes 7 000 abonnés.",
  }) || "", /Tessa Thyssen.*7 000 abonnés/);
  assert.equal(preparedEvidenceSignalSupported(
    "creator_behavior_signal",
    "J’avais posté plus de photos et publié davantage de vidéos sur mes réseaux sociaux.",
  ), true);
  assert.match(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Tessa Thyssen",
    claimType: "creator_behavior_signal",
    sourceExcerpt: "Tessa Thyssen : entretien. Si j’avais posté plus de photos, mon audience aurait grandi.",
  }) || "", /Tessa Thyssen.*posté plus de photos/);
  assert.equal(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Tessa Thyssen",
    claimType: "creator_behavior_signal",
    sourceExcerpt: "Tessa Thyssen : profile. Sa coéquipière explique publier des vidéos chaque semaine.",
  }), null, "a teammate's creator activity must not inherit the athlete title");
  assert.equal(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Tessa Thyssen",
    claimType: "audience_signal",
    sourceExcerpt: "Tessa Thyssen : entretien. Sa coéquipière explique avoir mes 120 000 abonnés.",
  }), null, "a non-first-person teammate sentence must not inherit the athlete title");
  assert.match(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Astrid Madrigal",
    claimType: "creator_behavior_signal",
    sourceExcerpt: "HER STORY: meet Astrid Madrigal – I’ve helped many girls fulfil their dream. The WorldWCR rider discusses her journey.",
  }) || "", /HER STORY: meet Astrid Madrigal/);
  assert.match(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Astrid Madrigal",
    claimType: "creator_behavior_signal",
    sourceExcerpt: "HER STORY: meet Astrid Madrigal – I’ve helped many girls fulfil their dream",
  }) || "", /HER STORY: meet Astrid Madrigal/);
  assert.equal(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Astrid Madrigal",
    claimType: "creator_behavior_signal",
    sourceExcerpt: "WorldWCR race report. Related: HER STORY: meet Astrid Madrigal. The report is about another rider.",
  }), null, "a related-story link on another article is not an athlete-centered feature");
  assert.equal(preparedEvidenceSignalSupported("athletic_momentum", "Navigation Rankings Record Book"), false);
  assert.equal(preparedEvidenceSignalSupported("athletic_momentum", "She won the national championship."), true);
  assert.equal(preparedEvidenceSignalSupported("athletic_momentum", "The athlete is listed as a pro team rider."), true);
  const seedingExcerpt = preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Paula Novotna",
    claimType: "athletic_momentum",
    sourceExcerpt: `current seeding list after GWA Tarifa 2024.\nSurf-Freestyle.\nMEN WOMEN\n${"1 Other Rider\n".repeat(40)}23 Paula Novotna\n24 Another Rider`,
  });
  assert.match(seedingExcerpt || "", /current seeding list after GWA Tarifa 2024/);
  assert.match(seedingExcerpt || "", /23 Paula Novotna/);
  assert.ok((seedingExcerpt || "").length < 700);
  assert.equal(preparedEvidenceSignalSupported("commercial_achievability_signal", "Main navigation Management Contact"), false);
  assert.equal(preparedEvidenceSignalSupported("commercial_achievability_signal", "She signed with a management agency."), true);
  assert.equal(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Jane Doe",
    claimType: "athletic_momentum",
    sourceExcerpt: "Jane Doe is a volleyball player. Teammate Riley Roe won the championship.",
  }), null);
  assert.match(preparedEvidenceSignalExcerptForAthlete({
    athleteName: "Jane Doe",
    claimType: "athletic_momentum",
    sourceExcerpt: "Jane Doe is a volleyball player. She won the championship.",
  }) || "", /Jane Doe.*She won/);
  assert.equal(preparedMomentumEffectiveAt("She won the national championship in 2021.", "2026-05-10T00:00:00.000Z"), "2021-01-01T00:00:00.000Z");
  assert.equal(preparedMomentumEffectiveAt("Current X Games medals and results", "2026-05-10T00:00:00.000Z"), "2026-05-10T00:00:00.000Z");
});

test("material momentum recognizes attributable French, Spanish, and Portuguese competition language", () => {
  assert.equal(preparedEvidenceSignalSupported(
    "athletic_momentum",
    "Tessa Thyssen a terminé la saison 2024 à la treizième place du classement mondial.",
  ), true);
  assert.equal(preparedEvidenceSignalSupported(
    "athletic_momentum",
    "Violeta Sanchez ganó la final y se clasificó para el mundial.",
  ), true);
  assert.equal(preparedEvidenceSignalSupported(
    "athletic_momentum",
    "A atleta venceu a final e garantiu a classificação.",
  ), true);
});

test("archive signal revalidation quarantines claims without deleting evidence or touching live tables", () => {
  const script = readFileSync(new URL("../scripts/revalidate-archived-material-signals.ts", import.meta.url), "utf8");
  assert.match(script, /support_status:\s*"unsupported"/);
  assert.match(script, /eligible_for_scoring:\s*false/);
  assert.match(script, /archive_signal_not_explicitly_attributed_to_named_athlete/);
  assert.doesNotMatch(script, /\.delete\s*\(/);
  for (const table of ["athletes", "notifications", "messages", "outreach_touchpoints"]) {
    assert.doesNotMatch(script, new RegExp(`from\\(["']${table}["']\\)`));
  }
});

test("evidence preparation is durable, replay-safe, zero-scoring, and isolated from outreach", () => {
  const workflow = readFileSync(new URL("../src/workflows/benchmark-evidence.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/research/golden-records/prepare-evidence/route.ts", import.meta.url), "utf8");
  const instagramHistoryRoute = readFileSync(new URL("../src/app/api/research/golden-records/reuse-instagram-history/route.ts", import.meta.url), "utf8");
  const socialBladeHistoryRoute = readFileSync(new URL("../src/app/api/research/golden-records/social-blade-history/route.ts", import.meta.url), "utf8");
  const benchmarkPage = readFileSync(new URL("../src/app/pipeline/research/benchmark/page.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20260811230420_add_research_evidence_preparation_runs.sql", import.meta.url), "utf8");
  const socialBladeAttemptMigration = readFileSync(new URL("../../supabase/migrations/20260813213119_lock_social_blade_paid_attempts.sql", import.meta.url), "utf8");
  assert.match(workflow, /"use workflow"/);
  assert.match(workflow, /"use step"/);
  assert.match(workflow, /discoverHistoricalEvidence\.maxRetries = 0/);
  assert.match(workflow, /retrieveArchivedEvidenceCandidate\.maxRetries = 0/);
  assert.doesNotMatch(workflow, /if \(attempt < 1\) await sleep\("20s"\)/);
  assert.doesNotMatch(workflow, /skipWayback/);
  assert.match(workflow, /let waybackCircuitOpen = false/);
  assert.match(workflow, /if \(archiveResult\.waybackRateLimited\) waybackCircuitOpen = true/);
  assert.match(workflow, /candidate\.storedCapture && !input\.waybackCircuitOpen/);
  assert.match(workflow, /wayback_rate_limited_after_direct_and_common_crawl_miss/);
  assert.match(workflow, /retrieveWaybackTimegateEvidenceCandidate/);
  assert.match(workflow, /Cutoff-safe external profiles referenced by/);
  assert.doesNotMatch(workflow, /if \(candidates\.length\) break/);
  assert.match(workflow, /Common Crawl is an optional free fallback/);
  assert.match(workflow, /loadCommonCrawlCollections\.maxRetries = 0/);
  assert.match(workflow, /deferredCandidates\.push\(\{ recordId: record\.id, url: candidate\.url \}\)/);
  assert.match(workflow, /phase: "archive_cooldown"/);
  assert.match(workflow, /replay will reuse paid discovery/);
  assert.match(workflow, /readApifyRunDatasetWithUsage/);
  assert.match(workflow, /maxTotalChargeUsd: input\.maxApifyChargeUsd/);
  assert.match(workflow, /outside the enforced \$0\.50-\$1\.00 range/);
  assert.match(workflow, /scoringTokensSpent: 0/);
  assert.match(workflow, /openrouter:web_search/);
  assert.match(workflow, /selectLatestOpenRouterSonnet/);
  assert.match(workflow, /api\/v1\/chat\/completions/);
  assert.match(workflow, /engine: "exa"/);
  assert.match(workflow, /mode: "deep"/);
  assert.match(workflow, /Promise\.all\(records\.flatMap/);
  assert.match(workflow, /eligibility_momentum/);
  assert.match(workflow, /audience_creator/);
  assert.match(workflow, /Age recovery gets one narrow search; signal recovery gets two/);
  assert.match(workflow, /name: "adult_eligibility"/);
  assert.match(workflow, /input\.preparationMode === "age_recovery"/);
  assert.match(workflow, /requireSportInDiscoveryMetadata: preparationMode !== "age_recovery"/);
  assert.match(workflow, /max_uses: 1/);
  assert.match(workflow, /max_tool_calls: 1/);
  assert.match(workflow, /reasoning: \{ effort: "low", exclude: true \}/);
  assert.match(workflow, /tool_choice: "required"/);
  assert.match(workflow, /max_tokens: 650/);
  assert.match(workflow, /server_tool_use\?\.web_search_requests/);
  assert.match(workflow, /reportedSearchRequests \|\| \(sources\.length > 0 \? 1 : 0\)/);
  assert.match(workflow, /searchRequests \* 12_000/);
  assert.match(workflow, /groundedHistoricalSignalDiscoveryCandidates/);
  assert.match(workflow, /deepDiscoveryCostMicrousd/);
  assert.match(workflow, /deep_discovery_tokens_spent/);
  assert.match(route, /deepDiscoveryConfigured/);
  assert.match(benchmarkPage, /grounded search/);
  assert.match(workflow, /item\.archiveProvider \|\| "internet_archive_wayback"/);
  assert.match(workflow, /selectCommonCrawlCapture/);
  assert.match(workflow, /Range: `bytes=\$\{capture\.offset\}-\$\{lastByte\}`/);
  assert.match(workflow, /archiveProvider: "common_crawl"/);
  assert.match(workflow, /archiveProvider: "wikimedia_revision"/);
  assert.match(workflow, /HISTORICAL_ARCHIVE_PROVIDER_VERSION/);
  assert.match(workflow, /from\("research_evidence_claims"\)\.delete\(\)/);
  assert.match(workflow, /reconcilePreparedSignalClaims/);
  for (const forbiddenTable of ["athletes", "research_candidates", "pipeline_athletes", "messages", "outreach_touchpoints", "channel_messages"]) {
    assert.ok(!workflow.includes(`from("${forbiddenTable}")`), `evidence workflow must not touch ${forbiddenTable}`);
    assert.ok(!route.includes(`from("${forbiddenTable}")`), `evidence route must not touch ${forbiddenTable}`);
  }
  assert.ok(route.indexOf("if (!selected.length)") < route.indexOf("await start(prepareBenchmarkEvidenceWorkflow"), "blind-label gate must run before workflow start");
  assert.match(route, /no provider call was started/);
  assert.match(route, /reuseProviderRunId/);
  assert.match(route, /run\.status === "failed"/);
  assert.match(route, /run\.status === "cancelled"/);
  assert.match(route, /historicalDiscoveryReplayCoverageMatches\(\{/);
  assert.match(route, /reusableSummary\?\.providerRunId/);
  assert.match(route, /ARCHIVE_RATE_LIMIT_COOLDOWN_MS/);
  assert.match(route, /archive_fallback_available: true/);
  assert.doesNotMatch(route, /status: 429, headers: \{ "retry-after"/);
  assert.match(route, /completedRecordIds/);
  assert.match(route, /requiredArchiveProviderVersion/);
  assert.match(route, /archiveProviderReplay/);
  assert.match(route, /archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION/);
  assert.match(route, /unresolvedFitRecordsForAgeRecovery/);
  assert.match(route, /unresolvedRecordsForBaseline/);
  assert.match(route, /&& !readiness\.ready/);
  assert.match(route, /freshBenchmarkLabelDeficits/);
  assert.match(route, /deficits\[record\.fit_label as "fit" \| "not_fit"\] > 0/);
  assert.match(route, /readiness\.momentum\.passed/);
  assert.match(route, /!readiness\.adult\.passed/);
  assert.match(route, /Number\(right\.readiness\.creatorPotential\.passed\)/);
  const ageSelectorStart = route.indexOf("async function unresolvedFitRecordsForAgeRecovery");
  const ageSelectorEnd = route.indexOf("async function unresolvedRecordsForBaseline", ageSelectorStart);
  const ageSelector = route.slice(ageSelectorStart, ageSelectorEnd);
  assert.ok(ageSelectorStart >= 0 && ageSelectorEnd > ageSelectorStart);
  assert.doesNotMatch(ageSelector, /baselineCompleted/);
  assert.match(ageSelector, /readiness\.identity\.passed/);
  assert.doesNotMatch(
    ageSelector,
    /&& readiness\.creatorPotential\.passed/,
    "age recovery must not wait on the independent creator-evidence lane"
  );
  assert.ok(
    ageSelector.indexOf("right.readiness.adult.independentSources")
      < ageSelector.indexOf("left.readiness.reasons.length"),
    "age recovery should close one-source adult gaps before broad zero-source cases"
  );
  assert.match(route, /ageRecoveryRemaining\.length \? "age_recovery" : "baseline"/);
  assert.match(route, /ageRecoveryRemaining\.length \? ageRecoveryRemaining : baselineRemaining/);
  assert.match(route, /eligibleForSignalRecovery/);
  assert.match(route, /body\.benchmarkSplit === "excluded"/);
  assert.match(route, /benchmarkSplit: preparationMode === "signal_recovery" \? signalRecoverySplit : null/);
  assert.match(route, /excludedSignalRecoveryCount/);
  assert.match(route, /requestedMode === "signal_recovery" \? signalRecoverySplit : "excluded"/);
  assert.match(route, /heldOutSignalRecoveryCount/);
  assert.match(route, /RESEARCH_HELD_OUT_EVALUATION_ENABLED/);
  assert.match(benchmarkPage, /maxRecords: evidencePreparationMode === "age_recovery" \? 10 : 3/);
  assert.match(benchmarkPage, /maxApifyChargeUsd: evidencePreparationMode === "age_recovery" \? 0\.75 : 0\.5/);
  const socialBladeRoute = readFileSync(new URL("../src/app/api/research/golden-records/social-blade-history/route.ts", import.meta.url), "utf8");
  const socialBladeCandidateStart = socialBladeRoute.indexOf("async function buildCandidatePlan");
  const socialBladeCandidateEnd = socialBladeRoute.indexOf("async function countApifyPublicHistoryAttempts", socialBladeCandidateStart);
  const socialBladeCandidateSelector = socialBladeRoute.slice(socialBladeCandidateStart, socialBladeCandidateEnd);
  assert.ok(socialBladeCandidateStart >= 0 && socialBladeCandidateEnd > socialBladeCandidateStart);
  assert.doesNotMatch(
    socialBladeCandidateSelector,
    /!readiness\.adult\.passed/,
    "Social Blade recovery must not wait on the independent age-evidence lane"
  );
  assert.match(workflow, /preparationMode === "signal_recovery"/);
  assert.match(workflow, /fresh excluded, development, or locked held-out evidence recovery/);
  assert.match(route, /extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION/);
  assert.match(route, /query_plan_version: queryPlanVersion/);
  assert.match(workflow, /extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION/);
  assert.match(workflow, /query_plan_version: input\.queryPlanVersion/);
  assert.match(workflow, /benchmark_split: input\.benchmarkSplit/);
  assert.match(route, /No active locked, unrevealed benchmark cohort exists/);
  assert.match(route, /activeCohortVersion/);
  assert.match(route, /requestedIds\.map\(\(recordId\) => eligibleById\.get\(recordId\)\)/);
  assert.match(route, /creatorOnlyBlocker/);
  assert.match(route, /Leave those[\s\S]+narrower signal-recovery plan/);
  assert.match(route, /\.contains\("stratification_tags", \["dylan_outcome_ground_truth"\]\)/);
  assert.match(benchmarkPage, /Recover fresh positives/);
  assert.match(benchmarkPage, /benchmarkSplit: "excluded"/);
  assert.match(benchmarkPage, /maxApifyChargeUsd: 0\.5/);
  assert.match(benchmarkPage, /recordIds: nextExcludedSignalRecoveryRecords/);
  assert.match(benchmarkPage, /Resume saved recovery/);
  assert.match(benchmarkPage, /processed_record_ids/);
  assert.match(benchmarkPage, /!completedExcludedSignalRecordIdSet\.has\(recordId\)/);
  assert.match(benchmarkPage, /newerCompletedSignalRecordIdSet/);
  assert.match(benchmarkPage, /run\.record_ids\.every/);
  assert.match(benchmarkPage, /Archive cooling down/);
  assert.match(workflow, /readApifyRunDatasetWithUsage<SearchPage>\(input\.reuseProviderRunId, 1_000\)/);
  assert.match(instagramHistoryRoute, /listApifyActorRuns/);
  assert.match(instagramHistoryRoute, /readApifyDatasetItems/);
  assert.match(instagramHistoryRoute, /new_actor_run_started: false/);
  assert.match(instagramHistoryRoute, /providerSpendUsd: 0/);
  assert.match(instagramHistoryRoute, /outreachMutationsAllowed: false/);
  assert.match(instagramHistoryRoute, /ONLYFANS_HISTORICAL_DATASET/);
  assert.match(instagramHistoryRoute, /\.contains\("stratification_tags", \[ONLYFANS_HISTORICAL_DATASET\]\)/);
  assert.match(socialBladeHistoryRoute, /ONLYFANS_HISTORICAL_DATASET/);
  assert.match(socialBladeHistoryRoute, /\.contains\("stratification_tags", \[ONLYFANS_HISTORICAL_DATASET\]\)/);
  assert.match(socialBladeHistoryRoute, /APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD = 0\.5/);
  assert.match(socialBladeHistoryRoute, /APIFY_PUBLIC_HISTORY_FAILURE_LIMIT = 2/);
  assert.match(socialBladeHistoryRoute, /MAX_OFFICIAL_PILOT_ATTEMPTS = 5/);
  assert.match(socialBladeHistoryRoute, /MAX_OFFICIAL_RECOVERY_ATTEMPTS = 24/);
  assert.match(socialBladeHistoryRoute, /MAX_OFFICIAL_SNAPSHOT_AGE_DAYS = 90/);
  assert.match(socialBladeHistoryRoute, /OFFICIAL_HISTORY_PLAN_VERSION = "max90-v2"/);
  assert.match(socialBladeHistoryRoute, /validate"\) === "connection"/);
  assert.match(socialBladeHistoryRoute, /No recently paid Social Blade profile is available for a zero-credit connection check/);
  assert.match(socialBladeHistoryRoute, /outreachMutationsAllowed: false/);
  assert.match(benchmarkPage, /Check Social Blade/);
  assert.match(benchmarkPage, /charged \$\{payload\.chargedCredits \?\? "unknown"\} credits/);
  assert.match(socialBladeHistoryRoute, /officialValidationPassed/);
  assert.match(socialBladeHistoryRoute, /officialHistoryStats\.matched >= MAX_OFFICIAL_PILOT_ATTEMPTS/);
  assert.match(socialBladeHistoryRoute, /officialHistoryAttemptedRecordIds/);
  assert.match(socialBladeHistoryRoute, /benchmarkEvidenceFreezeReadiness/);
  assert.match(socialBladeHistoryRoute, /!readiness\.identity\.passed \|\| !readiness\.momentum\.passed/);
  assert.doesNotMatch(
    socialBladeHistoryRoute,
    /!readiness\.adult\.passed \|\| !readiness\.momentum\.passed/,
    "paid audience recovery must not wait on the independent age lane"
  );
  assert.match(socialBladeHistoryRoute, /readiness\.creatorPotential\.passed/);
  assert.match(socialBladeHistoryRoute, /reserveOfficialHistoryAttempt/);
  assert.match(socialBladeHistoryRoute, /persistOfficialHistoryFailure/);
  assert.match(socialBladeHistoryRoute, /error\?\.code === "23505"/);
  assert.match(socialBladeHistoryRoute, /candidates\.filter\(\(candidate\) => !candidate\.officialHistoryAttempted\)\.slice\(0, 1\)/);
  assert.match(socialBladeHistoryRoute, /body\.recordId !== candidates\[0\]\.id/);
  assert.match(socialBladeHistoryRoute, /The verified paid-history recovery is closed after twenty-four checkpointed attempts/);
  assert.match(socialBladeHistoryRoute, /credits_remaining_after_request/);
  assert.match(socialBladeHistoryRoute, /creditsRemaining/);
  assert.doesNotMatch(socialBladeHistoryRoute, /maxRecords\?: number/);
  assert.match(benchmarkPage, /recordId: candidate\.id/);
  assert.match(benchmarkPage, /credits remain/);
  assert.match(benchmarkPage, /This profile produced no usable cutoff-safe snapshot and will not be retried/);
  assert.match(socialBladeHistoryRoute, /apifyPublicAttemptedRecordIds/);
  assert.match(socialBladeHistoryRoute, /retrieval_status: "error"/);
  assert.match(socialBladeHistoryRoute, /eligible_before_cutoff: false/);
  assert.doesNotMatch(socialBladeHistoryRoute, /source_type: "social_analytics"/);
  const runner = readFileSync(new URL("../src/lib/research/benchmark-runner.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /signalPreparedIds/);
  assert.match(runner, /Execution is gated by the evidence itself/);
  assert.match(runner, /held_out_revealed_at: completedAt/);
  assert.match(runner, /contains\("metrics", \{ cohort_version: cohortVersion \}\)/);
  assert.match(migration, /research_evidence_sources_golden_historical_url_uidx/);
  assert.match(migration, /research_evidence_claims_golden_source_type_uidx/);
  assert.match(migration, /revoke all on table public\.research_evidence_preparation_runs from anon, authenticated/);
  assert.match(socialBladeAttemptMigration, /create unique index if not exists research_evidence_sources_social_blade_attempt_uidx/);
  assert.match(socialBladeAttemptMigration, /where provider = 'social_blade_instagram_history'/);
  assert.match(socialBladeAttemptMigration, /provider_request_id is not null/);
});

test("fresh cohort assignment supports a locked 8+8 challenge after a revealed development replay", () => {
  const route = readFileSync(new URL("../src/app/api/research/golden-records/route.ts", import.meta.url), "utf8");
  const benchmarkRoute = readFileSync(new URL("../src/app/api/research/benchmarks/route.ts", import.meta.url), "utf8");
  const benchmarkPage = readFileSync(new URL("../src/app/pipeline/research/benchmark/page.tsx", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../src/lib/research/benchmark-runner.ts", import.meta.url), "utf8");
  assert.match(route, /const challengeMode = perLabel < 16/);
  assert.match(route, /if \(perLabel < 8\)/);
  assert.match(route, /selectBalancedChallengeHoldout\(untouchedEvidenceReady, 8\)/);
  assert.match(route, /previouslyScoredIds/);
  assert.match(route, /previously completed and revealed 8\+8 held-out run/);
  assert.match(route, /selectActiveBenchmarkCohort/);
  assert.match(route, /Complete or retire it before freezing another cohort/);
  assert.match(runner, /No active locked, unrevealed benchmark cohort exists/);
  assert.match(runner, /loadRevealedDevelopmentReplay/);
  assert.match(runner, /!activeCohort\.cohortVersion && input\.split === "held_out"/);
  assert.match(runner, /if \(!cohortVersion\) cohortVersion = replay\.sourceCohortVersion/);
  assert.match(runner, /replay_source_run_id/);
  assert.match(runner, /\.eq\("benchmark_cohort_version", cohortVersion\)/);
  assert.match(runner, /one-time held-out release must score the full/);
  assert.match(benchmarkRoute, /activeCohortVersion/);
  assert.match(benchmarkRoute, /const replayDevelopmentSource = activeDevelopmentRecords\.length === 0/);
  assert.match(benchmarkRoute, /activeCohortVersion \|\| replayDevelopmentSource\?\.cohortVersion/);
  assert.match(benchmarkRoute, /activeCohortConflict/);
  assert.match(benchmarkPage, /evidenceSummary\.readyFit < 8/);
  assert.match(benchmarkPage, /Freeze 8 \+ 8 challenge set/);
  assert.match(benchmarkPage, /Development archive/);
  assert.doesNotMatch(route, /clean source pool requires 40 resolved-sport/);
});

test("historical readiness audit loads claims in bounded batches instead of truncating at 1000", () => {
  const audit = readFileSync(new URL("../scripts/audit-onlyfans-historical-benchmark-readiness.ts", import.meta.url), "utf8");
  assert.match(audit, /recordIdChunks/);
  assert.match(audit, /recordIds\.slice\(index \* 20/);
  assert.match(audit, /evidenceBatches\.flatMap\(\(batch\) => batch\.claims\)/);
  assert.doesNotMatch(audit, /\.in\("golden_record_id", recordIds\),/);
});

test("the database permits evidence-gated Dylan outcome cases to freeze without inventing public knowability", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260812174331_allow_outcome_ground_truth_benchmark_split.sql", import.meta.url), "utf8");
  assert.match(migration, /decisive_information_publicly_knowable is not null/);
  assert.match(migration, /stratification_tags @> array\['dylan_outcome_ground_truth'\]::text\[\]/);
  assert.match(migration, /benchmark_split = 'excluded'/);
});

test("historical evidence import preserves prior cohort assignments and uses replay-safe detail sources", () => {
  const importer = readFileSync(new URL("../scripts/import-onlyfans-historical-benchmark.ts", import.meta.url), "utf8");
  assert.match(importer, /existingBenchmarkSplit = item\.existing!\.benchmark_split \|\| "excluded"/);
  assert.match(importer, /benchmark_split: existingBenchmarkSplit/);
  assert.match(importer, /historical_evidence_detail/);
  assert.match(importer, /provider_request_id: providerRequestId/);
  assert.doesNotMatch(importer, /from\("athletes"\)\.(?:insert|upsert|update|delete)/);
  for (const forbiddenTable of ["messages", "outreach_touchpoints", "channel_messages", "message_drafts"]) {
    assert.ok(!importer.includes(`from("${forbiddenTable}")`), `historical import must not touch ${forbiddenTable}`);
  }
});
