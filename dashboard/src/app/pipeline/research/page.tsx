"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FlaskConical, History, RefreshCw, ShieldCheck } from "lucide-react";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import {
  RESEARCH_SCORING_MODEL,
} from "@/lib/ai/models";
import {
  DEFAULT_RESEARCH_OBJECTIVE,
  ONLYFANS_CREATOR_PROFILE,
  type ResearchObjective,
} from "@/lib/research/scoring";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  pipeline_stage: string;
  created_at: string;
  source?: string;
  research_score?: number;
  research_reasoning?: string;
  age_verified?: boolean;
  age?: number;
  age_source?: string;
  is_minor?: boolean;
}

interface ResearchCandidate {
  id?: string;
  name: string;
  instagram_handle: string;
  instagram_url?: string;
  profile_pic_url?: string;
  follower_count?: number;
  engagement_rate?: number;
  bio?: string;
  sport: string;
  source: string;
  score?: number;
  reasoning?: string;
  concerns?: string[];
  similar_to?: string[];
  age_verified?: boolean;
  age?: number;
  age_source?: string;
  is_minor?: boolean;
  athlete_id?: string;
  pipeline_stage?: string;
  disposition?: "discovered" | "approval" | "held" | "blocked" | "existing" | "skipped" | "rejected";
  disposition_reason?: string;
  source_evidence?: Array<{ url?: string; title?: string; claim?: string; provider?: string }>;
  score_breakdown?: Record<string, number>;
  scoring_model?: string;
  prompt_version?: string;
  identity_status?: string;
  identity_confidence?: number;
  career_stage?: "emerging" | "established" | "veteran" | "unknown";
  objective_fit?: "strong" | "possible" | "weak";
  creator_signals?: string[];
  momentum_metrics?: {
    status?: "baseline" | "measured";
    follower_growth_absolute?: number;
    follower_growth_percent?: number;
    days_between_snapshots?: number;
  };
  gate_results?: Record<string, boolean>;
}

interface ResearchConfig {
  sportFocus: string;
  partnershipGoal?: ResearchObjective;
  depth?: "standard" | "extended";
  marketOverride?: string;
  customContext?: string; // e.g., "Winter Olympics 2026 hopefuls", "rising stars under 25"
  followerMin: number;
  followerMax: number;
  resultCount: number;
  scoringModel: string; // LLM for scoring candidates
  targetRegions?: string[];
  evaluationMode?: boolean;
}

interface ResearchLog {
  id: string;
  created_at: string;
  completed_at: string | null;
  heartbeat_at?: string | null;
  status: string;
  phase?: string;
  workflow_run_id?: string | null;
  prompt_version?: string;
  scoring_model?: string | null;
  is_evaluation?: boolean;
  cancel_requested_at?: string | null;
  error_message?: string | null;
  config_used: ResearchConfig;
  context_summary: {
    sport?: string;
    partnershipGoal?: ResearchObjective;
    objectiveProfile?: typeof ONLYFANS_CREATOR_PROFILE;
    customContext?: string;
    historical_count?: number;
    signed_conversion_count?: number;
    historical_record_count?: number;
    exclusion_count?: number;
    rejection_count?: number;
    top_sports?: string[];
    sportContext?: string;
    toolchain?: Array<{ step: string; provider: string; purpose: string }>;
    recruitingThesis?: { id?: string; version?: number; name?: string };
  };
  raw_results: Array<{
    name: string;
    handle: string;
    followers: number;
    sport: string;
  }>;
  scoring_details: Array<{
    handle: string;
    score: number;
    reasoning: string;
  }>;
  final_results: ResearchCandidate[];
  candidate_ledger?: ResearchCandidate[];
  stats: {
    sourced?: number;
    searched?: number;
    discovered?: number;
    enriched?: number;
    scored?: number;
    returned?: number;
    added?: number;
    held?: number;
    blocked?: number;
    duplicates?: number;
    skipped?: number;
    phase?: string;
  };
}

interface ResearchRun {
  id: string;
  status: string;
  config_used: ResearchConfig;
  final_results: ResearchCandidate[];
  stats: {
    searched: number;
    discovered: number;
    filtered: number;
    duplicates: number;
  };
}

interface ResearchBenchmarkSummary {
  total: number;
  active: number;
  evaluated: number;
  passed: number;
  passRate: number | null;
}

// Comprehensive alphabetical list of sports
const SPORT_OPTIONS = [
  { value: "baseball", label: "Baseball" },
  { value: "basketball", label: "Basketball" },
  { value: "bodybuilding", label: "Bodybuilding" },
  { value: "boxing", label: "Boxing" },
  { value: "cheerleading", label: "Cheerleading" },
  { value: "climbing", label: "Climbing" },
  { value: "crossfit", label: "CrossFit" },
  { value: "cycling", label: "Cycling" },
  { value: "dance", label: "Dance" },
  { value: "diving", label: "Diving" },
  { value: "equestrian", label: "Equestrian" },
  { value: "esports", label: "Esports" },
  { value: "figure-skating", label: "Figure Skating" },
  { value: "fitness", label: "Fitness" },
  { value: "football", label: "Football (American)" },
  { value: "golf", label: "Golf" },
  { value: "gymnastics", label: "Gymnastics" },
  { value: "hockey", label: "Hockey" },
  { value: "lacrosse", label: "Lacrosse" },
  { value: "martial-arts", label: "Martial Arts" },
  { value: "mma", label: "MMA / UFC" },
  { value: "motocross", label: "Motocross" },
  { value: "motorsports", label: "Motorsports" },
  { value: "olympic", label: "Olympic Sports" },
  { value: "pickleball", label: "Pickleball" },
  { value: "pilates", label: "Pilates" },
  { value: "pole-fitness", label: "Pole Fitness" },
  { value: "powerlifting", label: "Powerlifting" },
  { value: "rugby", label: "Rugby" },
  { value: "running", label: "Running / Track" },
  { value: "skateboarding", label: "Skateboarding" },
  { value: "skiing", label: "Skiing" },
  { value: "snowboarding", label: "Snowboarding" },
  { value: "soccer", label: "Soccer" },
  { value: "softball", label: "Softball" },
  { value: "surfing", label: "Surfing" },
  { value: "swimming", label: "Swimming" },
  { value: "tennis", label: "Tennis" },
  { value: "triathlon", label: "Triathlon" },
  { value: "volleyball", label: "Volleyball" },
  { value: "wakeboarding", label: "Wakeboarding" },
  { value: "weightlifting", label: "Weightlifting" },
  { value: "wrestling", label: "Wrestling" },
  { value: "yoga", label: "Yoga" },
  { value: "custom", label: "Custom (enter below)" },
];

const REJECTION_REASONS = [
  { value: "not_athlete", label: "Not an Athlete (fan page, meme, news)" },
  { value: "not_individual", label: "Not a Real Person (brand, business, team)" },
  { value: "wrong_niche", label: "Wrong Sport/Niche" },
  { value: "too_big", label: "Too Big (>500K followers)" },
  { value: "too_small", label: "Too Small (<10K followers)" },
  { value: "has_of", label: "Already Has OnlyFans" },
  { value: "bad_engagement", label: "Poor Engagement/Quality" },
  { value: "not_usa", label: "Not USA-Based" },
  { value: "already_contacted", label: "Already Contacted Before" },
  { value: "not_active", label: "Inactive Account" },
  { value: "bad_content", label: "Low Quality Content" },
  { value: "other", label: "Other (specify in notes)" },
];

function ResearchStageContent() {
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session");

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Research states
  const [isResearching] = useState(false);
  const [researchProgress] = useState({ current: 0, total: 0, message: "" });
  const [researchResults, setResearchResults] = useState<ResearchCandidate[]>([]);
  const [currentResearchRun] = useState<ResearchRun | null>(null);

  // Research history
  const [researchLogs, setResearchLogs] = useState<ResearchLog[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [activeResearchView, setActiveResearchView] = useState<"history" | "prospects">("history");

  // Notification/toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Rejection states
  const [rejectingCandidate, setRejectingCandidate] = useState<ResearchCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");

  // Config form
  const [config, setConfig] = useState<ResearchConfig>({
    sportFocus: "mma",
    partnershipGoal: DEFAULT_RESEARCH_OBJECTIVE,
    depth: "standard",
    marketOverride: "",
    customContext: "",
    followerMin: 30000,
    followerMax: 500000,
    resultCount: 10,
    scoringModel: RESEARCH_SCORING_MODEL,
    targetRegions: ["usa"],
  });

  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const [benchmarkSummary, setBenchmarkSummary] = useState<ResearchBenchmarkSummary | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkUnavailable, setBenchmarkUnavailable] = useState(false);

  // Background research state
  const [backgroundRunId, setBackgroundRunId] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const loadBenchmarks = useCallback(async () => {
    const response = await fetch("/api/research/evaluations", { cache: "no-store" });
    const data = await response.json() as { summary?: ResearchBenchmarkSummary; error?: string };
    if (!response.ok) {
      setBenchmarkUnavailable(true);
      return;
    }
    setBenchmarkUnavailable(false);
    setBenchmarkSummary(data.summary || null);
  }, []);

  const fetchAthletes = useCallback(async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=research");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchResearchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const response = await fetch("/api/research/logs?limit=20");
      const data = await response.json();
      setResearchLogs(data.logs || []);
    } catch (error) {
      console.error("Error fetching research logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  // Auto-expand session from URL param
  useEffect(() => {
    if (sessionIdFromUrl && researchLogs.length > 0) {
      // Check if the session exists in our logs
      const sessionExists = researchLogs.some(log => log.id === sessionIdFromUrl);
      if (sessionExists) {
        // Defer state and scrolling together so the effect does not create a
        // synchronous render cascade.
        const timeoutId = setTimeout(() => {
          setExpandedLogId(sessionIdFromUrl);
          const element = document.getElementById(`research-log-${sessionIdFromUrl}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [sessionIdFromUrl, researchLogs]);

  const startPollingForCompletion = useCallback((runId: string) => {
    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    // Poll every 3 seconds
    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/research/logs?limit=10`);
        const data = await response.json();
        const logs = data.logs || [];

        // Find the specific research run
        const targetLog = logs.find((log: ResearchLog) => log.id === runId);

        if (targetLog && ["completed", "error", "failed", "cancelled"].includes(targetLog.status)) {
          // Research finished!
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          localStorage.removeItem("research_background_run_id");
          setBackgroundRunId(null);

          // Refresh logs
          void fetchResearchLogs();

          // Show completion notification
          if (targetLog.status === "completed") {
            const finalistCount = targetLog.stats?.returned || 0;
            const approvalCount = targetLog.stats?.added || 0;
            setToast({
              message: `Research complete: ${finalistCount} finalists, ${approvalCount} added to Approval.`,
              type: "success",
            });

            // Browser notification
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Research Complete!", {
                body: `${finalistCount} finalists; ${approvalCount} added to Approval. Open the run for the evidence and decisions.`,
                icon: "/favicon.ico",
              });
            }
          } else if (targetLog.status === "cancelled") {
            setToast({ message: "Research run cancelled.", type: "info" });
          } else {
            setToast({
              message: "Research encountered an error. Check the logs for details.",
              type: "error",
            });
          }
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 3000);
  }, [fetchResearchLogs]);

  // Check for running research sessions in the database
  const checkForRunningResearch = useCallback(async () => {
    try {
      const response = await fetch("/api/research/logs?limit=5");
      const data = await response.json();
      const logs = data.logs || [];
      const runningLog = logs.find((log: ResearchLog) => ["queued", "running"].includes(log.status));

      if (runningLog) {
        setBackgroundRunId(runningLog.id);
        localStorage.setItem("research_background_run_id", runningLog.id);
        startPollingForCompletion(runningLog.id);
        setToast({ message: "Research is still running in the background...", type: "info" });
        return;
      }

      const savedRunId = localStorage.getItem("research_background_run_id");
      if (!savedRunId) return;
      const savedLog = logs.find((log: ResearchLog) => log.id === savedRunId);
      if (savedLog?.status === "completed") {
        localStorage.removeItem("research_background_run_id");
        setToast({
          message: `Research complete: ${savedLog.stats?.returned || 0} finalists, ${savedLog.stats?.added || 0} added to Approval.`,
          type: "success",
        });
      } else if (!savedLog) {
        localStorage.removeItem("research_background_run_id");
      }
    } catch (error) {
      console.error("Error checking for running research:", error);
    }
  }, [startPollingForCompletion]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void Promise.all([
        fetchAthletes(),
        fetchResearchLogs(),
        loadBenchmarks(),
        checkForRunningResearch(),
      ]).catch((error) => console.error("Could not initialize research:", error));

    }, 0);

    return () => {
      window.clearTimeout(initialLoad);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [checkForRunningResearch, fetchAthletes, fetchResearchLogs, loadBenchmarks]);

  // Auto-hide toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleRunResearch = async () => {
    setShowConfigModal(false);

    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Show immediate toast
    setToast({
      message: "Research started! We'll notify you when it's complete.",
      type: "success",
    });

    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "research_started",
        title: "Research Started",
        message: `Running ${config.depth === "extended" ? "extended" : "standard"} research for ${config.sportFocus}`,
        metadata: { config },
      }),
    }).catch(() => {});

    // Set a temporary placeholder while waiting for real ID
    setBackgroundRunId("starting");

    try {
      const response = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const runId = data.runId;
      setShowResultsModal(false);
      if (runId) {
        setExpandedLogId(runId);
        setBackgroundRunId(runId);
        localStorage.setItem("research_background_run_id", runId);
        startPollingForCompletion(runId);
      }
      await fetchResearchLogs();
      setToast({
        message: "Research queued safely. You can leave this page and come back anytime.",
        type: "success",
      });
    } catch (error) {
      console.error("Error running research:", error);

      // Refresh logs to see if any partial result was saved
      fetchResearchLogs();

      // Clear background tracking
      localStorage.removeItem("research_background_run_id");
      setBackgroundRunId(null);

      setToast({
        message: "Research failed: " + (error instanceof Error ? error.message : "Unknown error"),
        type: "error",
      });
    }
  };

  const handleCancelResearch = async (runId: string) => {
    try {
      const response = await fetch(`/api/research/runs/${runId}/cancel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not cancel research");
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
      localStorage.removeItem("research_background_run_id");
      setBackgroundRunId(null);
      await fetchResearchLogs();
      setToast({ message: "Research run cancelled.", type: "info" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "Could not cancel research",
        type: "error",
      });
    }
  };

  const handleBenchmarkAction = async (action: "seed" | "run") => {
    setBenchmarkBusy(true);
    try {
      const response = await fetch("/api/research/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json() as { error?: string; created?: number; evaluated?: number; passed?: number };
      if (!response.ok) throw new Error(data.error || "Benchmark action failed");
      await loadBenchmarks();
      setToast({
        type: "success",
        message: action === "seed"
          ? `${data.created || 0} safety and quality benchmark cases created.`
          : `${data.passed || 0} of ${data.evaluated || 0} research benchmarks passed.`,
      });
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Benchmark action failed",
      });
    } finally {
      setBenchmarkBusy(false);
    }
  };

  const handleApproveCandidate = async (candidate: ResearchCandidate) => {
    try {
      const response = await fetch("/api/research/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate,
          researchRunId: currentResearchRun?.id,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Remove from results, add to athletes list
      setResearchResults((prev) => prev.filter((c) => c.instagram_handle !== candidate.instagram_handle));

      if (data.athlete) {
        setAthletes((prev) => [data.athlete, ...prev]);
      }
    } catch (error) {
      console.error("Error approving candidate:", error);
      alert("Failed to approve: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const handleRejectCandidate = async () => {
    if (!rejectingCandidate || !rejectReason) return;

    try {
      await fetch("/api/research/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate: rejectingCandidate,
          researchRunId: currentResearchRun?.id,
          reason: rejectReason,
          notes: rejectNotes,
        }),
      });

      // Remove from results
      setResearchResults((prev) =>
        prev.filter((c) => c.instagram_handle !== rejectingCandidate.instagram_handle)
      );

      setShowRejectModal(false);
      setRejectingCandidate(null);
      setRejectReason("");
      setRejectNotes("");
    } catch (error) {
      console.error("Error rejecting candidate:", error);
    }
  };

  const handleMoveToApproval = async (athleteId: string) => {
    try {
      const response = await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "approval" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not move candidate to Approval");
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Could not move candidate to Approval", type: "error" });
    }
  };

  const handleReject = async (athleteId: string) => {
    if (!confirm("Remove this prospect from the pipeline?")) return;
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: null }),
      });
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (error) {
      console.error("Error rejecting athlete:", error);
    }
  };

  const toggleReasoning = (id: string) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredAthletes = athletes.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.sport.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.instagram_handle?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatFollowers = (count?: number) => {
    if (!count) return "—";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
    return count.toString();
  };

  const latestCompletedLog = researchLogs.find((log) => log.status === "completed");
  const latestStats = latestCompletedLog?.stats;

  const getCandidateDisposition = (
    candidate: ResearchCandidate
  ): NonNullable<ResearchCandidate["disposition"]> => {
    if (candidate.pipeline_stage === "approval") return "approval";
    if (candidate.pipeline_stage === "research") return "held";
    if (candidate.disposition === "discovered") return "discovered";
    if (candidate.disposition === "rejected") return "rejected";
    if (candidate.disposition === "approval") return "approval";
    if (candidate.is_minor === true || candidate.score === 0 || candidate.disposition === "blocked") return "blocked";
    if (candidate.disposition === "existing") return "existing";
    if (candidate.disposition === "skipped") return "skipped";
    if (candidate.age_verified !== true || (candidate.score || 0) < 75 || candidate.disposition === "held") return "held";
    return "approval";
  };

  const getDispositionPresentation = (
    disposition: ReturnType<typeof getCandidateDisposition>,
    isEvaluation: boolean
  ) => ({
    approval: {
      label: isEvaluation ? "Qualified in simulation" : "Added to Approval",
      className: "bg-blue-100 text-blue-800",
    },
    held: {
      label: isEvaluation ? "Held in simulation" : "Held in Research",
      className: "bg-amber-100 text-amber-800",
    },
    blocked: { label: "Safety blocked", className: "bg-red-100 text-red-800" },
    existing: { label: "Already in CRM", className: "bg-gray-100 text-gray-800" },
    skipped: { label: "Not saved", className: "bg-gray-100 text-gray-700" },
    discovered: { label: "Sourced, not finalized", className: "bg-purple-100 text-purple-800" },
    rejected: { label: "Rejected", className: "bg-rose-100 text-rose-800" },
  } as const)[disposition];

  const latestOutcomeCounts = (latestCompletedLog?.final_results || []).reduce(
    (counts, candidate) => {
      counts[getCandidateDisposition(candidate)] += 1;
      return counts;
    },
    { approval: 0, held: 0, blocked: 0, existing: 0, skipped: 0, discovered: 0, rejected: 0 }
  );

  const fallbackToolchain = (log: ResearchLog) => [
    { step: "Discovery", provider: "Perplexity", purpose: "Find source-linked athlete candidates" },
    { step: "Identity & age", provider: "Apify Google Search", purpose: "Resolve profiles and trustworthy age sources" },
    { step: "Instagram", provider: "Apify Instagram Profile Scraper", purpose: "Load profile and audience data" },
    { step: "Scoring", provider: log.config_used?.scoringModel || RESEARCH_SCORING_MODEL, purpose: "Score fit and explain why" },
    { step: "Pipeline", provider: "Supabase", purpose: "Store evidence and candidate disposition" },
  ];

  // Copy settings from a past research run to pre-fill the form
  const copySettingsFromLog = (log: ResearchLog) => {
    const logConfig = log.config_used;
    if (!logConfig) return;

    // Update config state
    setConfig({
      sportFocus: logConfig.sportFocus || "mma",
      partnershipGoal: DEFAULT_RESEARCH_OBJECTIVE,
      depth: logConfig.depth || ((logConfig.resultCount || 10) > 10 ? "extended" : "standard"),
      marketOverride: logConfig.marketOverride || logConfig.customContext || "",
      customContext: logConfig.customContext || "",
      followerMin: logConfig.followerMin || 30000,
      followerMax: logConfig.followerMax || 500000,
      resultCount: logConfig.resultCount || 10,
      scoringModel: logConfig.scoringModel || config.scoringModel,
      targetRegions: logConfig.targetRegions || ["usa"],
      evaluationMode: logConfig.evaluationMode === true,
    });

    // Open the config modal
    setShowConfigModal(true);

    // Show toast
    setToast({
      message: `Copied settings from "${logConfig.sportFocus}" search. Tweak and run!`,
      type: "info",
    });
  };

  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading research workspace">
        <div className="h-[54px] animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />
        <div className="h-16 w-2/3 animate-pulse bg-brand-ink/8" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stage Navigation */}
      <PipelineStageNav currentStage="research" />

      {/* Header */}
      <div className="pc-page-header !mb-0">
        <div>
          <p className="pc-eyebrow">Candidate intelligence</p>
          <h1 className="pc-page-title">Research</h1>
          <p className="pc-page-description">Source, verify, and score emerging athletes before they enter the partnership pipeline.</p>
        </div>
        <div className="pc-header-actions">
          <Link
            href="/pipeline/research/intelligence"
            className="pc-button-secondary"
          >
            Recruiting thesis
          </Link>
          <button
            onClick={() => setShowConfigModal(true)}
            disabled={isResearching}
            className="pc-button-primary"
          >
            {isResearching ? (
              <><RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" /> Researching</>
            ) : backgroundRunId ? (
              <><RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" /> Research running</>
            ) : (
              <><FlaskConical aria-hidden="true" className="h-4 w-4" /> Run research agent</>
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-brand-ink/10" role="tablist" aria-label="Research workspace views">
        {([
          { id: "history", label: "Runs", count: researchLogs.length },
          { id: "prospects", label: "Held prospects", count: athletes.length },
        ] as const).map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={activeResearchView === view.id}
            onClick={() => setActiveResearchView(view.id)}
            className={`border-b-2 pb-3 text-sm font-semibold transition ${activeResearchView === view.id ? "border-brand-blue text-brand-ink" : "border-transparent text-brand-muted hover:text-brand-ink"}`}
          >
            {view.label} <span className="ml-1 font-mono text-[9px] text-brand-muted">{view.count}</span>
          </button>
        ))}
      </div>

      {/* Research Progress */}
      {isResearching && (
        <div className="border border-brand-cyan bg-brand-cyan/10 p-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 animate-spin text-brand-blue" />
            <div className="flex-1">
              <div className="font-medium text-brand-ink">{researchProgress.message}</div>
              <div className="mt-2 h-1 w-full bg-brand-chrome/50">
                <div
                  className="h-1 bg-brand-blue transition-all"
                  style={{
                    width: `${researchProgress.total > 0 ? (researchProgress.current / researchProgress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Background Research Indicator */}
      {backgroundRunId && !isResearching && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="animate-pulse text-2xl">🔄</div>
              <div>
                <div className="font-medium text-blue-800">
                  {backgroundRunId === "starting"
                    ? "Starting research..."
                    : "Research running in background"}
                </div>
                <div className="text-sm text-blue-600">
                  {backgroundRunId === "starting"
                    ? "Connecting to APIs and discovering athletes..."
                    : "You'll be notified when complete. Feel free to navigate away."}
                </div>
              </div>
            </div>
            {backgroundRunId !== "starting" && (
              <button
                onClick={() => {
                  if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                  }
                  localStorage.removeItem("research_background_run_id");
                  setBackgroundRunId(null);
                  void handleCancelResearch(backgroundRunId);
                }}
                className="px-3 py-1 text-sm text-blue-700 hover:bg-blue-100 rounded"
              >
                Cancel Run
              </button>
            )}
          </div>
        </div>
      )}

      {activeResearchView === "history" && latestCompletedLog ? (
        <section className="pc-surface flex flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setExpandedLogId(latestCompletedLog.id)}
            className="min-w-0 text-left"
          >
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-blue">Latest completed run</span>
            <span className="mt-1 block truncate text-sm font-semibold capitalize text-brand-ink">
              {latestCompletedLog.config_used?.sportFocus || "Research"}
            </span>
            <span className="mt-0.5 block text-xs text-brand-muted">{new Date(latestCompletedLog.created_at).toLocaleDateString()}</span>
          </button>
          <div className="grid grid-cols-3 divide-x divide-brand-ink/10 border border-brand-ink/10 bg-brand-paper-bright">
            {[
              ["Researched", latestStats?.discovered || 0],
              ["Finalists", latestStats?.returned || 0],
              [latestCompletedLog.is_evaluation ? "Qualified" : "Approval", latestOutcomeCounts.approval],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-20 px-3 py-2 text-center sm:min-w-24">
                <div className="text-lg font-bold tabular-nums text-brand-ink">{value}</div>
                <div className="font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-brand-muted">{label}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeResearchView === "history" ? (
      <details className="pc-surface group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:content-none">
          <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-brand-blue" /> Quality controls</span>
          <span className="text-xs text-brand-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-brand-ink/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-brand-blue" />
              <h2 className="font-semibold text-brand-ink">Research quality gate</h2>
              {benchmarkSummary?.passRate !== null && benchmarkSummary?.passRate !== undefined ? (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${benchmarkSummary.passRate === 100 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                  {benchmarkSummary.passRate}% passing
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-brand-ink/60">
              Repeatable controls verify score weighting, adult-age gating, minor blocking, and the minimum quality threshold before candidates can enter Approval.
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.04em] text-brand-ink/55">
              {benchmarkUnavailable
                ? "Quality suite is waiting for the database migration; research runs remain unavailable until setup is complete."
                : `${benchmarkSummary?.total || 0} cases · ${benchmarkSummary?.evaluated || 0} evaluated · benchmark replays never create athletes or send outreach`}
            </p>
          </div>
          <button
            type="button"
            disabled={benchmarkBusy || benchmarkUnavailable}
            onClick={() => void handleBenchmarkAction((benchmarkSummary?.total || 0) === 0 ? "seed" : "run")}
            className="pc-button-secondary shrink-0"
          >
            {benchmarkBusy
              ? "Working…"
              : benchmarkUnavailable
                ? "Setup required"
              : (benchmarkSummary?.total || 0) === 0
                ? "Create baseline suite"
                : "Run benchmark suite"}
          </button>
        </div>
      </details>
      ) : null}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 animate-slide-in ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : toast.type === "error"
              ? "bg-red-600 text-white"
              : "bg-blue-600 text-white"
          }`}
        >
          <span>
            {toast.type === "success" ? "✓" : toast.type === "error" ? "✗" : "ℹ"}
          </span>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 hover:opacity-70"
          >
            ×
          </button>
          {toast.type === "success" && (
            <Link
              href={expandedLogId ? `/pipeline/research?session=${expandedLogId}` : "/pipeline/research"}
              className="ml-2 underline hover:no-underline"
            >
              Review run →
            </Link>
          )}
        </div>
      )}

      {/* Research History */}
      {activeResearchView === "history" ? (
      <div className="pc-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-brand-ink/10 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <History aria-hidden="true" className="h-4 w-4 text-brand-blue" /> Runs
          </h2>
          <button
            onClick={fetchResearchLogs}
            className="inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-brand-blue hover:text-brand-ink"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {loadingLogs ? (
          <div className="p-8 text-center text-gray-800">Loading history...</div>
        ) : researchLogs.length === 0 ? (
          <div className="p-12 text-center text-brand-ink/60">
            <FlaskConical aria-hidden="true" className="mx-auto mb-3 h-6 w-6 text-brand-blue" />
            <p className="text-sm">No research runs yet. Start a focused search to build the first candidate set.</p>
            <button type="button" onClick={() => setShowConfigModal(true)} className="mt-4 inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-brand-blue">
              Configure research <ArrowRight aria-hidden="true" className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="divide-y">
            {researchLogs.map((log) => {
              const isRunning = log.status === "queued" || log.status === "running";
              const outcomeCounts = (log.final_results || []).reduce(
                (counts, candidate) => {
                  counts[getCandidateDisposition(candidate)] += 1;
                  return counts;
                },
                { approval: 0, held: 0, blocked: 0, existing: 0, skipped: 0, discovered: 0, rejected: 0 }
              );
              const toolchain = log.context_summary?.toolchain?.length
                ? log.context_summary.toolchain
                : fallbackToolchain(log);
              const candidateLedger = log.candidate_ledger?.length
                ? log.candidate_ledger
                : log.final_results || [];
              return (
              <div key={log.id} id={`research-log-${log.id}`} className={`${isRunning ? "bg-amber-50/40" : ""} ${expandedLogId === log.id ? "bg-brand-paper-bright" : "hover:bg-brand-paper/60"}`}>
                {/* Log Header - Clickable */}
                <button
                  onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`h-2 w-2 shrink-0 ${
                        log.status === "completed"
                          ? "bg-emerald-500"
                          : log.status === "error" || log.status === "failed"
                          ? "bg-red-500"
                          : "bg-yellow-500 animate-pulse"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 truncate text-sm font-semibold capitalize text-brand-ink">
                        {log.config_used?.sportFocus || "Research Run"}
                        {log.is_evaluation && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            Evaluation only
                          </span>
                        )}
                        {isRunning && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full animate-pulse">
                            {log.status === "queued" ? "Queued" : "Running"} · {(log.phase || log.stats?.phase || "starting").replaceAll("_", " ")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-brand-muted">
                        {new Date(log.created_at).toLocaleDateString()} · {log.config_used?.scoringModel || RESEARCH_SCORING_MODEL}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {isRunning ? (
                      <div className="text-right">
                        <div className="text-xs font-semibold text-amber-800">Searching…</div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-brand-ink">
                          {log.stats?.returned || log.final_results?.length || 0} finalists
                        </div>
                      </div>
                    )}
                    <span className={`text-xs text-brand-muted transition ${expandedLogId === log.id ? "rotate-180" : ""}`}>
                      ⌄
                    </span>
                  </div>
                </button>

                {/* Expanded Log Details */}
                {expandedLogId === log.id && (
                  <div className="px-4 pb-4 space-y-4">
                    {(log.status === "error" || log.status === "failed") && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                        <p className="font-semibold">Research stopped before completion</p>
                        <p className="mt-1">{log.error_message || "The run did not complete. Copy the settings and try a smaller batch."}</p>
                      </div>
                    )}
                    <div className="flex flex-col gap-3 border-y border-brand-ink/10 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-brand-muted">
                        <strong className="text-brand-ink">{log.stats?.sourced || log.candidate_ledger?.length || log.stats?.discovered || 0}</strong> sourced
                        <span aria-hidden="true">→</span>
                        <strong className="text-brand-ink">{log.stats?.discovered || log.stats?.searched || log.raw_results?.length || 0}</strong> researched
                        <span aria-hidden="true">→</span>
                        <strong className="text-brand-ink">{log.stats?.returned || log.final_results?.length || 0}</strong> finalists
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copySettingsFromLog(log);
                        }}
                        className="inline-flex min-h-9 items-center justify-center border border-brand-chrome bg-white px-3 font-mono text-[9px] font-bold uppercase tracking-wide text-brand-blue hover:border-brand-blue"
                      >
                        Reuse settings
                      </button>
                    </div>

                    {/* Inputs */}
                    <details className="group border border-brand-ink/10 bg-white">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-brand-ink marker:content-none">
                        Run setup and sources
                        <span className="text-xs text-brand-muted transition group-open:rotate-180">⌄</span>
                      </summary>
                      <div className="space-y-4 border-t border-brand-ink/10 p-4">
                    <div className="bg-brand-paper p-4">
                      <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                        <span>⚙️</span> Inputs
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-800">Sport:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.sportFocus}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Objective:</span>{" "}
                          <span className="text-gray-900">OnlyFans · emerging creator talent</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Followers:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.followerMin?.toLocaleString()}-{log.config_used?.followerMax?.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Market override:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.marketOverride || log.config_used?.customContext || "Active thesis default"}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Scoring Model:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.scoringModel || RESEARCH_SCORING_MODEL}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Depth:</span>{" "}
                          <span className="capitalize text-gray-900">{log.config_used?.depth || ((log.config_used?.resultCount || 10) > 10 ? "extended" : "standard")}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Started:</span>{" "}
                          <span className="text-gray-900">{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        {log.config_used?.customContext && (
                          <div className="col-span-2">
                            <span className="text-gray-800">Search brief:</span>{" "}
                            <span className="text-gray-900">{log.config_used.customContext}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Evidence and toolchain */}
                    <div className="bg-brand-cyan/5 p-4">
                      <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                        <span>🧠</span> Research inputs and tools
                      </h4>
                      <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div className="rounded-md bg-white/80 px-3 py-2">
                          <span className="text-gray-600">Signed/active contracts supplied to scoring:</span>{" "}
                          <strong className="text-gray-900">{log.context_summary?.signed_conversion_count ?? log.context_summary?.historical_count ?? "Not recorded"}</strong>
                        </div>
                        <div className="rounded-md bg-white/80 px-3 py-2">
                          <span className="text-gray-600">Existing/historical handles excluded:</span>{" "}
                          <strong className="text-gray-900">{log.context_summary?.exclusion_count ?? "Not recorded"}</strong>
                        </div>
                      </div>
                      {log.context_summary?.recruitingThesis && (
                        <div className="mb-3 rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                          Recruiting thesis: <strong>{log.context_summary.recruitingThesis.name || "Active thesis"}</strong> · version {log.context_summary.recruitingThesis.version || "—"}
                        </div>
                      )}
                      <div className="space-y-2">
                        {toolchain.map((tool) => (
                          <div key={`${tool.step}-${tool.provider}`} className="grid gap-1 rounded-md border border-blue-100 bg-white px-3 py-2 text-sm sm:grid-cols-[130px_190px_1fr]">
                            <span className="font-medium text-gray-900">{tool.step}</span>
                            <span className="text-blue-800">{tool.provider}</span>
                            <span className="text-gray-600">{tool.purpose}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                      </div>
                    </details>

                    {/* Outputs */}
                    <div className="border border-brand-ink/10 bg-white p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
                        <ArrowRight className="h-4 w-4 text-brand-blue" /> Finalists
                      </h4>
                      <p className="mb-2 text-xs text-brand-muted">
                        {outcomeCounts.approval} {log.is_evaluation ? "qualified" : "in approval"} · {outcomeCounts.held} held · {outcomeCounts.blocked} blocked
                        {(log.stats?.duplicates ?? outcomeCounts.existing) > 0 ? ` · ${log.stats?.duplicates ?? outcomeCounts.existing} already in CRM` : ""}
                      </p>
                      {candidateLedger.length > 0 && (
                        <div className="divide-y divide-brand-ink/10">
                          {candidateLedger.map((result, idx) => {
                            const disposition = getCandidateDisposition(result);
                            const presentation = getDispositionPresentation(disposition, log.is_evaluation === true);
                            const reasoningKey = `${log.id}:${result.instagram_handle || idx}`;
                            const isReasoningExpanded = expandedReasoning.has(reasoningKey);
                            return (
                              <div key={reasoningKey} className="py-3">
                                <button
                                  type="button"
                                  onClick={() => toggleReasoning(reasoningKey)}
                                  className="flex w-full items-start justify-between gap-3 text-left"
                                  aria-expanded={isReasoningExpanded}
                                >
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-semibold text-gray-900">{result.name}</span>
                                      <span className="text-sm text-gray-600">@{result.instagram_handle}</span>
                                      <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${presentation.className}`}>
                                        {presentation.label}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-xs text-gray-600">
                                      {formatFollowers(result.follower_count)} followers · {result.sport}
                                    </div>
                                  </div>
                                  <div className="flex flex-shrink-0 items-center gap-2">
                                    <span className={`px-2 py-1 text-xs font-bold ${
                                      (result.score || 0) >= 80
                                        ? "bg-brand-ink text-brand-cyan"
                                        : (result.score || 0) >= 60
                                          ? "bg-amber-100 text-amber-900"
                                          : "bg-brand-paper text-brand-muted"
                                    }`}>
                                      {typeof result.score === "number" ? `${result.score}/100` : "Unscored"}
                                    </span>
                                    <span className="text-gray-500">{isReasoningExpanded ? "▼" : "▶"}</span>
                                  </div>
                                </button>

                                {isReasoningExpanded && (
                                  <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                                    <div>
                                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Why this score</div>
                                      <p className="mt-1 text-gray-800">{result.reasoning || "No scoring explanation was stored for this legacy run."}</p>
                                    </div>
                                    {result.score_breakdown && Object.keys(result.score_breakdown).length > 0 && (
                                      <div>
                                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Score dimensions</div>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                          {Object.entries(result.score_breakdown).map(([dimension, value]) => (
                                            <div key={dimension} className="rounded-md border bg-white px-3 py-2">
                                              <div className="text-xs capitalize text-gray-500">{dimension.replaceAll("_", " ")}</div>
                                              <div className="mt-0.5 font-semibold text-gray-900">{Math.round(value)}/100</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {result.source_evidence && result.source_evidence.length > 0 && (
                                      <div>
                                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Source evidence</div>
                                        <div className="mt-2 space-y-2">
                                          {result.source_evidence.map((evidence, evidenceIndex) => (
                                            <div key={`${evidence.url || evidence.title || "evidence"}-${evidenceIndex}`} className="rounded-md border bg-blue-50 px-3 py-2">
                                              <div className="flex flex-wrap items-center gap-2">
                                                {evidence.url ? (
                                                  <a href={evidence.url} target="_blank" rel="noreferrer" className="font-medium text-blue-800 hover:underline">
                                                    {evidence.title || "Open source"}
                                                  </a>
                                                ) : (
                                                  <span className="font-medium text-gray-900">{evidence.title || "Stored source"}</span>
                                                )}
                                                {evidence.provider && <span className="text-xs text-gray-500">via {evidence.provider}</span>}
                                              </div>
                                              {evidence.claim && <p className="mt-1 text-xs text-gray-700">{evidence.claim}</p>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <div className="rounded-md bg-gray-50 px-3 py-2">
                                        <span className="text-gray-500">Discovery source:</span>{" "}
                                        <span className="text-gray-900">{result.source || "Not recorded"}</span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2 sm:col-span-2">
                                        <span className="text-gray-500">Audience momentum:</span>{" "}
                                        <span className="text-gray-900">
                                          {result.momentum_metrics?.status === "measured"
                                            ? `${(result.momentum_metrics.follower_growth_percent || 0).toFixed(2)}% follower change over ${result.momentum_metrics.days_between_snapshots || "—"} days`
                                            : "Baseline snapshot captured; growth will appear after the next dated snapshot"}
                                        </span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2">
                                        <span className="text-gray-500">Identity confidence:</span>{" "}
                                        <span className="text-gray-900">
                                          {result.identity_status || "legacy"}{typeof result.identity_confidence === "number" ? ` · ${Math.round(result.identity_confidence)}%` : ""}
                                        </span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2">
                                        <span className="text-gray-500">Career stage:</span>{" "}
                                        <span className="capitalize text-gray-900">{result.career_stage || "Not recorded"}</span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2">
                                        <span className="text-gray-500">Objective fit:</span>{" "}
                                        <span className="capitalize text-gray-900">{result.objective_fit || "Not recorded"}</span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2">
                                        <span className="text-gray-500">Scoring version:</span>{" "}
                                        <span className="text-gray-900">{result.scoring_model || log.scoring_model || "legacy"} · {result.prompt_version || log.prompt_version || "legacy"}</span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2">
                                        <span className="text-gray-500">Age check:</span>{" "}
                                        <span className="text-gray-900">
                                          {result.age_verified
                                            ? `Verified adult${result.age ? `, age ${result.age}` : ""}`
                                            : disposition === "blocked"
                                              ? `Blocked${result.age ? `, age ${result.age}` : " by safety screen"}`
                                              : "Not source-verified"}
                                        </span>
                                      </div>
                                      <div className="rounded-md bg-gray-50 px-3 py-2 sm:col-span-2">
                                        <span className="text-gray-500">Age source:</span>{" "}
                                        <span className="break-all text-gray-900">{result.age_source || "No trustworthy source stored"}</span>
                                      </div>
                                    </div>
                                    {result.creator_signals && result.creator_signals.length > 0 && (
                                      <div>
                                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Creator-business signals</div>
                                        <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-800">
                                          {result.creator_signals.map((signal) => <li key={signal}>{signal}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                    {(result.disposition_reason || result.concerns?.length) && (
                                      <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-950">
                                        {result.disposition_reason && <p className="font-medium">{result.disposition_reason}</p>}
                                        {result.concerns && result.concerns.length > 0 && (
                                          <ul className="mt-1 list-disc space-y-1 pl-5">
                                            {result.concerns.map((concern) => <li key={concern}>{concern}</li>)}
                                          </ul>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
      ) : null}

      {/* Search */}
      {activeResearchView === "prospects" ? (
      <>
      <div className="pc-surface p-4">
        <input
          type="text"
          placeholder="Search prospects..."
          aria-label="Search research prospects"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border px-4 py-2 focus:outline-none"
        />
      </div>

      {/* Prospects List */}
      {filteredAthletes.length === 0 ? (
        <div className="border border-dashed border-brand-chrome bg-white p-12 text-center">
          <FlaskConical className="mx-auto mb-4 h-8 w-8 text-brand-blue" />
          <h3 className="mb-2 font-display text-2xl font-semibold uppercase tracking-wide text-brand-ink">No prospects in research</h3>
          <p className="text-sm text-gray-800 max-w-md mx-auto mb-4">
            Run the Research Agent to discover new athlete prospects from Instagram, news, and social media.
          </p>
          <button
            onClick={() => setShowConfigModal(true)}
            disabled={isResearching}
            className="pc-button-primary"
          >
            {isResearching ? "Running..." : "Start Research"}
          </button>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Prospect</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Sport</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Followers</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Score</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredAthletes.map((athlete) => {
                const approvalEligible = athlete.age_verified === true
                  && athlete.is_minor !== true
                  && typeof athlete.research_score === "number"
                  && athlete.research_score >= 75;
                const approvalReason = athlete.is_minor
                  ? "Safety blocked"
                  : athlete.age_verified !== true
                    ? "Verify adult age"
                    : typeof athlete.research_score !== "number" || athlete.research_score < 75
                      ? "Score below 60"
                      : "Ready for Approval";
                return (
                <tr key={athlete.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <AthleteAvatar
                        name={athlete.name}
                        profilePicUrl={athlete.profile_pic_url}
                        size="md"
                      />
                      <div>
                        <Link
                          href={`/athletes/${athlete.id}`}
                          className="font-medium text-gray-900 hover:text-purple-600"
                        >
                          {athlete.name}
                        </Link>
                        {athlete.instagram_handle && (
                          <div className="text-sm text-gray-800">@{athlete.instagram_handle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-800">{athlete.sport}</td>
                  <td className="px-4 py-3 text-sm text-gray-800">
                    {formatFollowers(athlete.follower_count)}
                  </td>
                  <td className="px-4 py-3">
                    {athlete.research_score ? (
                      <span
                        className={`px-2 py-1 rounded text-sm font-medium ${
                          athlete.research_score >= 80
                            ? "bg-green-100 text-green-700"
                            : athlete.research_score >= 75
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {athlete.research_score}
                      </span>
                    ) : (
                      <span className="text-gray-800">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {approvalEligible ? (
                        <button
                          onClick={() => handleMoveToApproval(athlete.id)}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
                        >
                          → Approval
                        </button>
                      ) : (
                        <span className="rounded bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800" title="Verified adult age and a research score of at least 75 are required">
                          {approvalReason}
                        </span>
                      )}
                      <button
                        onClick={() => handleReject(athlete.id)}
                        className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      ) : null}

      {/* Focused research launcher */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span>🔬</span> Start athlete research
              </h2>
              <p className="text-sm text-gray-800 mt-1">
                Three choices. The active recruiting thesis handles the rest.
              </p>
            </div>

            <div className="p-6 space-y-6">
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-violet-950">OnlyFans · emerging athlete creators</div>
                    <p className="mt-1 text-xs leading-5 text-violet-900/80">Latest Sonnet scoring, evidence-linked identity and age checks, and no automatic outreach.</p>
                  </div>
                  <Link href="/pipeline/research/intelligence" onClick={() => setShowConfigModal(false)} className="shrink-0 text-xs font-semibold text-violet-800 underline underline-offset-2">View thesis</Link>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  1. Sport *
                </label>
                <select
                  value={config.sportFocus}
                  onChange={(e) => setConfig({ ...config, sportFocus: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {SPORT_OPTIONS.filter(opt => opt.value !== "custom").map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  2. Market override <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., U.S. college athletes or 2028 Olympic hopefuls"
                  value={config.marketOverride || ""}
                  onChange={(e) => setConfig({ ...config, marketOverride: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-gray-800 mt-1">
                  Leave blank to use the active thesis exactly as published.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  3. Research depth
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: "standard", title: "Standard", detail: "Up to 10 qualified athletes" },
                    { value: "extended", title: "Extended", detail: "Two distinct 10-athlete waves" },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setConfig({ ...config, depth: option.value, resultCount: option.value === "extended" ? 20 : 10 })}
                      className={`rounded-xl border p-4 text-left ${config.depth === option.value ? "border-purple-600 bg-purple-50 ring-2 ring-purple-100" : "border-gray-200 hover:border-purple-300"}`}
                    >
                      <span className="block text-sm font-semibold text-gray-950">{option.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-gray-600">{option.detail}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-800 mt-2">The agent will not pad the result. If only six candidates clear the evidence and fit gates, you get six.</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-700">
                Source target: {config.depth === "extended" ? "up to 100" : "up to 50"} names → identity verification → Instagram enrichment → age and legitimacy gates → latest Sonnet scoring. Research never sends messages.
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-between items-center">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRunResearch()}
                disabled={!!backgroundRunId || isResearching || !config.sportFocus}
                className="pc-button-primary"
              >
                <FlaskConical className="h-4 w-4" /> Start research
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Modal */}
      {showResultsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-brand-chrome bg-white">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-display text-2xl font-bold uppercase tracking-wide text-brand-ink">
                  <FlaskConical className="h-5 w-5 text-brand-blue" /> Research results
                </h2>
                <p className="text-sm text-gray-800 mt-1">
                  {researchResults.length} candidates found • Approve or reject each
                </p>
              </div>
              <button
                onClick={() => setShowResultsModal(false)}
                className="text-gray-800 hover:text-gray-800 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {researchResults.length === 0 ? (
                <div className="py-12 text-center text-brand-muted">
                  <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-brand-blue" />
                  <p>All candidates processed.</p>
                </div>
              ) : (
                researchResults.map((candidate) => (
                  <div
                    key={candidate.instagram_handle}
                    className="bg-white border rounded-lg p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-4">
                      {/* Profile */}
                      <div className="flex-shrink-0">
                        <AthleteAvatar
                          name={candidate.name}
                          profilePicUrl={candidate.profile_pic_url}
                          size="xl"
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-gray-900">{candidate.name}</h3>
                          <span
                            className={`px-2 py-0.5 rounded text-sm font-medium ${
                              (candidate.score || 0) >= 80
                                ? "bg-green-100 text-green-700"
                                : (candidate.score || 0) >= 60
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            Score: {candidate.score ?? "—"}
                          </span>
                        </div>
                        <div className="text-sm text-gray-800 mt-1">
                          <a
                            href={`https://instagram.com/${candidate.instagram_handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            @{candidate.instagram_handle}
                          </a>
                          <span className="mx-2">•</span>
                          {formatFollowers(candidate.follower_count)} followers
                          <span className="mx-2">•</span>
                          {candidate.sport}
                        </div>
                        {candidate.bio && (
                          <p className="text-sm text-gray-800 mt-2 line-clamp-2">{candidate.bio}</p>
                        )}

                        {/* Expandable Reasoning */}
                        <button
                          onClick={() => toggleReasoning(candidate.instagram_handle)}
                          className="text-sm text-purple-600 hover:text-purple-800 mt-2 flex items-center gap-1"
                        >
                          {expandedReasoning.has(candidate.instagram_handle) ? "▼" : "▶"} Agent Reasoning
                        </button>
                        {expandedReasoning.has(candidate.instagram_handle) && (
                          <div className="mt-2 p-3 bg-purple-50 rounded-lg text-sm">
                            <p className="text-gray-800">{candidate.reasoning}</p>
                            {candidate.concerns && candidate.concerns.length > 0 && (
                              <div className="mt-2">
                                <span className="font-medium text-yellow-700">Concerns:</span>
                                <ul className="list-disc list-inside text-yellow-700">
                                  {candidate.concerns.map((c, i) => (
                                    <li key={i}>{c}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {candidate.similar_to && candidate.similar_to.length > 0 && (
                              <div className="mt-2">
                                <span className="font-medium text-green-700">Similar to:</span>{" "}
                                <span className="text-green-700">{candidate.similar_to.join(", ")}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => handleApproveCandidate(candidate)}
                          className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium text-sm"
                        >
                          ✓ Approve
                        </button>
                        <button
                          onClick={() => {
                            setRejectingCandidate(candidate);
                            setShowRejectModal(true);
                          }}
                          className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-sm"
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
              <div className="text-sm text-gray-800">
                {researchResults.length} remaining
              </div>
              <button
                onClick={() => setShowResultsModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && rejectingCandidate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">
                Reject {rejectingCandidate.name}?
              </h2>
              <p className="text-sm text-gray-800 mt-1">
                This feedback helps improve future research
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Reason for rejection
                </label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">— Select a reason —</option>
                  {REJECTION_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Additional notes (optional)
                </label>
                <textarea
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="Any specific feedback..."
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectingCandidate(null);
                  setRejectReason("");
                  setRejectNotes("");
                }}
                className="px-4 py-2 text-gray-800 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectCandidate}
                disabled={!rejectReason}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResearchStagePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="text-gray-600">Loading research...</div></div>}>
      <ResearchStageContent />
    </Suspense>
  );
}
