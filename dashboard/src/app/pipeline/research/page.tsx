"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import {
  RESEARCH_SCORING_MODEL,
} from "@/lib/ai/models";

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
  score: number;
  reasoning: string;
  concerns?: string[];
  similar_to?: string[];
}

interface ResearchConfig {
  sportFocus: string;
  customContext?: string; // e.g., "Winter Olympics 2026 hopefuls", "rising stars under 25"
  followerMin: number;
  followerMax: number;
  resultCount: number;
  scoringModel: string; // LLM for scoring candidates
  targetRegions?: string[];
  voiceContext?: string; // Voice transcription context
  keywords?: string; // Search keywords
}

interface ResearchLog {
  id: string;
  created_at: string;
  completed_at: string | null;
  heartbeat_at?: string | null;
  status: string;
  error_message?: string | null;
  config_used: ResearchConfig;
  context_summary: {
    historical_count: number;
    rejection_count: number;
    top_sports: string[];
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
  stats: {
    searched: number;
    scored: number;
    returned: number;
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

interface ScoringModelOption {
  id: string;
  displayName: string;
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

const REGION_OPTIONS = [
  { value: "usa", label: "USA (Primary Focus)" },
  { value: "canada", label: "Canada" },
  { value: "uk", label: "United Kingdom" },
  { value: "australia", label: "Australia" },
  { value: "brazil", label: "Brazil" },
  { value: "ireland", label: "Ireland" },
  { value: "global", label: "Global (No Filter)" },
];

// Sport-specific region presets
const SPORT_REGION_PRESETS: Record<string, string[]> = {
  "combat": ["usa", "brazil", "uk", "ireland"],
  "golf": ["usa", "uk", "australia", "ireland"],
  "surfing": ["usa", "australia", "brazil"],
  "hockey": ["usa", "canada"],
  "soccer": ["usa", "uk"],
  "fitness": ["usa", "uk", "australia"],
  "historical": ["usa"],
};

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
  const [isResearching, setIsResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState({ current: 0, total: 0, message: "" });
  const [researchResults, setResearchResults] = useState<ResearchCandidate[]>([]);
  const [currentResearchRun, setCurrentResearchRun] = useState<ResearchRun | null>(null);

  // Research history
  const [researchLogs, setResearchLogs] = useState<ResearchLog[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Notification/toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Rejection states
  const [rejectingCandidate, setRejectingCandidate] = useState<ResearchCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");

  // Config form
  const [config, setConfig] = useState<ResearchConfig>({
    sportFocus: "mma",
    customContext: "",
    followerMin: 30000,
    followerMax: 500000,
    resultCount: 10,
    scoringModel: RESEARCH_SCORING_MODEL,
    targetRegions: ["usa"],
  });
  const [scoringModels, setScoringModels] = useState<ScoringModelOption[]>([]);
  const [loadingScoringModels, setLoadingScoringModels] = useState(true);

  // Separate state for follower inputs to allow empty values while typing
  const [followerMinInput, setFollowerMinInput] = useState("30000");
  const [followerMaxInput, setFollowerMaxInput] = useState("500000");

  // Historical athletes for "Find more like" dropdown
  const [historicalAthletes, setHistoricalAthletes] = useState<Athlete[]>([]);
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Background research state
  const [backgroundRunId, setBackgroundRunId] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchAthletes();
    fetchHistoricalAthletes();
    fetchResearchLogs();

    // Check for any RUNNING research in the database (persists across page navigations)
    checkForRunningResearch();

    fetch("/api/ai/models", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { models?: ScoringModelOption[]; defaultModel?: string }) => {
        if (data.models?.length) {
          setScoringModels(data.models);
          setConfig((current) => ({
            ...current,
            scoringModel: data.models!.some((model) => model.id === current.scoringModel)
              ? current.scoringModel
              : data.defaultModel || data.models![0].id,
          }));
        }
      })
      .catch((error) => console.error("Could not load Anthropic models:", error))
      .finally(() => setLoadingScoringModels(false));

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Auto-expand session from URL param
  useEffect(() => {
    if (sessionIdFromUrl && researchLogs.length > 0) {
      // Check if the session exists in our logs
      const sessionExists = researchLogs.some(log => log.id === sessionIdFromUrl);
      if (sessionExists) {
        setExpandedLogId(sessionIdFromUrl);
        // Scroll to the session after a brief delay
        setTimeout(() => {
          const element = document.getElementById(`research-log-${sessionIdFromUrl}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
      }
    }
  }, [sessionIdFromUrl, researchLogs]);

  // Check for running research sessions in the database
  const checkForRunningResearch = async () => {
    try {
      const response = await fetch("/api/research/logs?limit=5");
      const data = await response.json();
      const logs = data.logs || [];

      // Find any running research
      const runningLog = logs.find((log: ResearchLog) => log.status === "running");

      if (runningLog) {
        setBackgroundRunId(runningLog.id);
        localStorage.setItem("research_background_run_id", runningLog.id);
        startPollingForCompletion(runningLog.id);

        setToast({
          message: "Research is still running in the background...",
          type: "info",
        });
      } else {
        // No running research - clean up localStorage if there was a stale entry
        const savedRunId = localStorage.getItem("research_background_run_id");
        if (savedRunId) {
          // Check if that saved run is now complete
          const savedLog = logs.find((log: ResearchLog) => log.id === savedRunId);
          if (savedLog && savedLog.status === "completed") {
            localStorage.removeItem("research_background_run_id");
            // Might have missed the completion - show notification
            setToast({
              message: `Research complete! Found ${savedLog.stats?.returned || 0} candidates.`,
              type: "success",
            });
          } else if (!savedLog) {
            // Old/invalid ID, clear it
            localStorage.removeItem("research_background_run_id");
          }
        }
      }
    } catch (error) {
      console.error("Error checking for running research:", error);
    }
  };

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

        if (targetLog && ["completed", "error", "failed"].includes(targetLog.status)) {
          // Research finished!
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          localStorage.removeItem("research_background_run_id");
          setBackgroundRunId(null);

          // Refresh logs
          fetchResearchLogs();

          // Show completion notification
          if (targetLog.status === "completed") {
            const candidateCount = targetLog.stats?.added || targetLog.stats?.returned || 0;
            setToast({
              message: `Research complete! Found ${candidateCount} candidates.`,
              type: "success",
            });

            // Browser notification
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Research Complete!", {
                body: `Found ${candidateCount} new athlete candidates. Review them in the Approval tab.`,
                icon: "/favicon.ico",
              });
            }
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
  }, []);

  // Auto-hide toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchAthletes = async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=research");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistoricalAthletes = async () => {
    try {
      const response = await fetch("/api/historical?limit=50");
      const data = await response.json();
      setHistoricalAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching historical athletes:", error);
    }
  };

  const fetchResearchLogs = async () => {
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
  };

  // Audio recording state refs
  const streamRef = useRef<MediaStream | null>(null);

  // Audio recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Try different audio formats in order of preference for OpenAI Whisper
      let mimeType = 'audio/webm';
      const formats = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav'
      ];

      for (const format of formats) {
        if (MediaRecorder.isTypeSupported(format)) {
          mimeType = format;
          break;
        }
      }

      console.log('Using audio format:', mimeType);

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Handle transcription in a separate function to avoid async issues
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        handleTranscription(audioBlob);
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("Could not access microphone. Please grant permission.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  };

  const handleTranscription = (audioBlob: Blob) => {
    // Check if we have valid audio data
    if (!audioBlob || audioBlob.size < 1000) {
      console.error("Audio blob too small:", audioBlob?.size);
      alert("Recording too short. Please try again and speak for at least 1 second.");
      return;
    }

    console.log("Transcribing audio:", audioBlob.type, audioBlob.size, "bytes");
    setIsTranscribing(true);

    const formData = new FormData();
    // Determine extension from blob type
    let extension = 'webm';
    if (audioBlob.type.includes('mp4')) extension = 'm4a';
    else if (audioBlob.type.includes('ogg')) extension = 'ogg';
    else if (audioBlob.type.includes('wav')) extension = 'wav';

    formData.append("audio", audioBlob, `recording.${extension}`);

    fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.text) {
          setConfig((prev) => ({
            ...prev,
            voiceContext: prev.voiceContext
              ? `${prev.voiceContext}\n${data.text}`
              : data.text,
          }));
        } else if (data.error) {
          console.error("Transcription error:", data.error);
        }
      })
      .catch((error) => {
        console.error("Error transcribing audio:", error);
      })
      .finally(() => {
        setIsTranscribing(false);
      });
  };

  const handleRunResearch = async (runInBackground = false) => {
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

    // IMMEDIATELY log "Research Started" notification
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "research_started",
        title: "Research Started",
        message: `Searching for ${config.sportFocus} athletes (${config.followerMin.toLocaleString()}-${config.followerMax.toLocaleString()} followers)`,
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
      const results = data.results || [];
      setCurrentResearchRun(data.run);
      setResearchResults(results);
      setShowResultsModal(results.length > 0);

      // Research is now complete (the API is synchronous)
      // Clear background tracking
      localStorage.removeItem("research_background_run_id");
      setBackgroundRunId(null);

      // Refresh logs to get the real data
      fetchResearchLogs();

      // Backend now auto-adds candidates to approval stage
      const addedCount = data.stats?.added || results.length;

      // Show toast notification
      if (addedCount > 0) {
        setToast({
          message: `Found ${addedCount} candidates! Check the Approval tab to review.`,
          type: "success",
        });

        // Browser notification
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Research Complete!", {
            body: `Found ${addedCount} new athlete candidates. Review them in the Approval tab.`,
            icon: "/favicon.ico",
          });
        }
      } else {
        setToast({
          message: "No candidates found matching your criteria. Try adjusting filters.",
          type: "info",
        });
      }
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
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "approval" }),
      });
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (error) {
      console.error("Error moving athlete:", error);
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

  // Copy settings from a past research run to pre-fill the form
  const copySettingsFromLog = (log: ResearchLog) => {
    const logConfig = log.config_used;
    if (!logConfig) return;

    // Update config state
    setConfig({
      sportFocus: logConfig.sportFocus || "mma",
      customContext: logConfig.customContext || "",
      followerMin: logConfig.followerMin || 30000,
      followerMax: logConfig.followerMax || 500000,
      resultCount: logConfig.resultCount || 10,
      scoringModel: logConfig.scoringModel || config.scoringModel,
      targetRegions: logConfig.targetRegions || ["usa"],
    });

    // Update the follower input fields to match
    setFollowerMinInput(String(logConfig.followerMin || 30000));
    setFollowerMaxInput(String(logConfig.followerMax || 500000));

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
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stage Navigation */}
      <PipelineStageNav currentStage="research" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-3xl">🔍</span> Research
          </h1>
          <p className="text-gray-600">Discover and evaluate new prospects</p>
        </div>
        <button
          onClick={() => setShowConfigModal(true)}
          disabled={isResearching}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
        >
          {isResearching ? (
            <>
              <span className="animate-spin">⏳</span> Researching...
            </>
          ) : backgroundRunId ? (
            <>
              <span className="animate-pulse">🔄</span> Background Running
            </>
          ) : (
            <>
              <span>🚀</span> Run Research Agent
            </>
          )}
        </button>
      </div>

      {/* Research Progress */}
      {isResearching && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin text-2xl">🔍</div>
            <div className="flex-1">
              <div className="font-medium text-purple-800">{researchProgress.message}</div>
              <div className="w-full bg-purple-200 rounded-full h-2 mt-2">
                <div
                  className="bg-purple-600 h-2 rounded-full transition-all"
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
                  setToast({ message: "Background tracking cancelled (research may still complete)", type: "info" });
                }}
                className="px-3 py-1 text-sm text-blue-700 hover:bg-blue-100 rounded"
              >
                Stop Tracking
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-purple-700">{athletes.length}</div>
          <div className="text-sm text-purple-600">Discovered Prospects</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {athletes.filter((a) => a.follower_count && a.follower_count >= 100000).length}
          </div>
          <div className="text-sm text-gray-800">100K+ Followers</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {athletes.filter((a) => a.research_score && a.research_score >= 80).length}
          </div>
          <div className="text-sm text-gray-800">High Score (80+)</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {historicalAthletes.length}
          </div>
          <div className="text-sm text-gray-800">Historical Context</div>
        </div>
      </div>

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
              href="/pipeline"
              className="ml-2 underline hover:no-underline"
            >
              Go to Approval →
            </Link>
          )}
        </div>
      )}

      {/* Research History */}
      <div className="bg-white shadow rounded-lg">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <span>📋</span> Research History
          </h2>
          <button
            onClick={fetchResearchLogs}
            className="text-sm text-purple-600 hover:text-purple-700"
          >
            Refresh
          </button>
        </div>

        {loadingLogs ? (
          <div className="p-8 text-center text-gray-800">Loading history...</div>
        ) : researchLogs.length === 0 ? (
          <div className="p-8 text-center text-gray-800">
            <div className="text-2xl mb-2">📭</div>
            No research runs yet. Click &quot;Run Research Agent&quot; to get started.
          </div>
        ) : (
          <div className="divide-y">
            {researchLogs.map((log) => {
              const isRunning = log.status === "running" || log.status === "pending";
              return (
              <div key={log.id} id={`research-log-${log.id}`} className={`hover:bg-gray-50 ${isRunning ? "bg-yellow-50/50" : ""} ${expandedLogId === log.id ? "ring-2 ring-purple-300 rounded-lg" : ""}`}>
                {/* Log Header - Clickable */}
                <button
                  onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        log.status === "completed"
                          ? "bg-green-500"
                          : log.status === "error" || log.status === "failed"
                          ? "bg-red-500"
                          : "bg-yellow-500 animate-pulse"
                      }`}
                    />
                    <div>
                      <div className="font-medium text-gray-900 flex items-center gap-2">
                        {log.config_used?.sportFocus || "Research Run"}
                        {isRunning && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full animate-pulse">
                            Running...
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-800">
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {isRunning ? (
                      <div className="text-right">
                        <div className="text-sm font-medium text-yellow-700">
                          Searching...
                        </div>
                        <div className="text-xs text-gray-800">
                          {log.config_used?.followerMin?.toLocaleString()}-{log.config_used?.followerMax?.toLocaleString()} followers
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {log.stats?.returned || 0} candidates
                        </div>
                        <div className="text-xs text-gray-800">
                          from {log.stats?.searched || 0} searched
                        </div>
                      </div>
                    )}
                    <span className="text-gray-800">
                      {expandedLogId === log.id ? "▼" : "▶"}
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
                    {/* Copy & Tweak Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copySettingsFromLog(log);
                      }}
                      className="w-full py-2 px-4 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>📋</span> Copy & Tweak Settings
                    </button>

                    {/* Inputs */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                        <span>⚙️</span> Inputs
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-800">Sport:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.sportFocus}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Followers:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.followerMin?.toLocaleString()}-{log.config_used?.followerMax?.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Regions:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.targetRegions?.join(", ") || "Global"}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Scoring Model:</span>{" "}
                          <span className="text-gray-900">{log.config_used?.scoringModel || RESEARCH_SCORING_MODEL}</span>
                        </div>
                        {log.config_used?.keywords && (
                          <div className="col-span-2">
                            <span className="text-gray-800">Keywords:</span>{" "}
                            <span className="text-gray-900">{log.config_used.keywords}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions/Context */}
                    <div className="bg-blue-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                        <span>🧠</span> Context Used
                      </h4>
                      <div className="text-sm space-y-1">
                        <div>
                          <span className="text-gray-800">Historical athletes referenced:</span>{" "}
                          <span className="text-gray-900">{log.context_summary?.historical_count || 0}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Rejection patterns applied:</span>{" "}
                          <span className="text-gray-900">{log.context_summary?.rejection_count || 0}</span>
                        </div>
                        <div>
                          <span className="text-gray-800">Top sports focus:</span>{" "}
                          <span className="text-gray-900">{log.context_summary?.top_sports?.join(", ") || "None"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Outputs */}
                    <div className="bg-green-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                        <span>📤</span> Outputs
                      </h4>
                      <div className="text-sm text-gray-900 mb-2">
                        Found <strong>{log.final_results?.length || 0}</strong> candidates
                      </div>
                      {log.final_results && log.final_results.length > 0 && (
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {log.final_results.slice(0, 5).map((result, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between bg-white rounded px-3 py-2"
                            >
                              <div>
                                <span className="font-medium">{result.name}</span>
                                <span className="text-gray-800 ml-2">
                                  @{result.instagram_handle}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-800">
                                  {result.follower_count?.toLocaleString()}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    result.score >= 80
                                      ? "bg-green-100 text-green-700"
                                      : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {result.score}
                                </span>
                              </div>
                            </div>
                          ))}
                          {log.final_results.length > 5 && (
                            <div className="text-center text-sm text-gray-800">
                              +{log.final_results.length - 5} more
                            </div>
                          )}
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

      {/* Search */}
      <div className="bg-white shadow rounded-lg p-4">
        <input
          type="text"
          placeholder="Search prospects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      {/* Prospects List */}
      {filteredAthletes.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Prospects in Research</h3>
          <p className="text-sm text-gray-800 max-w-md mx-auto mb-4">
            Run the Research Agent to discover new athlete prospects from Instagram, news, and social media.
          </p>
          <button
            onClick={() => setShowConfigModal(true)}
            disabled={isResearching}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
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
              {filteredAthletes.map((athlete) => (
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
                            : athlete.research_score >= 60
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
                      <button
                        onClick={() => handleMoveToApproval(athlete.id)}
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
                      >
                        → Approval
                      </button>
                      <button
                        onClick={() => handleReject(athlete.id)}
                        className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Config Modal - Simplified v2 */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span>🔬</span> Research Agent v2
              </h2>
              <p className="text-sm text-gray-800 mt-1">
                Powered by Perplexity AI - finds real professional athletes
              </p>
            </div>

            <div className="p-6 space-y-5">
              {/* How it works */}
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-4 border border-purple-100">
                <h3 className="font-medium text-gray-900 mb-2">How it works:</h3>
                <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                  <li>Discovers leagues & competitions for your sport</li>
                  <li>Finds real professional athletes from verified sources</li>
                  <li>Looks up their Instagram handles</li>
                  <li>Scores them on partnership fit</li>
                </ol>
              </div>

              {/* Sport Focus */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Sport/Niche *
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

              {/* Custom Context - NEW */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Custom Context (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., Winter Olympics 2026 hopefuls, rising stars under 25, X Games competitors"
                  value={config.customContext || ""}
                  onChange={(e) => setConfig({ ...config, customContext: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-gray-800 mt-1">
                  Add specific context to focus the search (events, age range, achievements)
                </p>
              </div>

              {/* Follower Range */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Follower Range
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-700">Minimum (leave empty for no min)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={followerMinInput}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setFollowerMinInput(val);
                        // Empty or 0 means no minimum (use 0)
                        setConfig({ ...config, followerMin: parseInt(val) || 0 });
                      }}
                      placeholder="No minimum"
                      className="w-full border rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-700">Maximum (leave empty for no max)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={followerMaxInput}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setFollowerMaxInput(val);
                        // Empty or 0 means no maximum (use very high number)
                        setConfig({ ...config, followerMax: val ? parseInt(val) : 999999999 });
                      }}
                      placeholder="No maximum"
                      className="w-full border rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-800 mt-1">
                  {!followerMinInput && !followerMaxInput ? "No limits set" :
                   !followerMinInput ? `Up to ${parseInt(followerMaxInput).toLocaleString()} followers` :
                   !followerMaxInput ? `${parseInt(followerMinInput).toLocaleString()}+ followers` :
                   `${parseInt(followerMinInput).toLocaleString()} - ${parseInt(followerMaxInput).toLocaleString()} followers`}
                </p>
              </div>

              {/* Result Count */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Number of Results
                </label>
                <select
                  value={config.resultCount}
                  onChange={(e) => setConfig({ ...config, resultCount: parseInt(e.target.value) })}
                  className="w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value={5}>5 results (faster)</option>
                  <option value={10}>10 results</option>
                </select>
                <p className="text-xs text-gray-800 mt-1">
                  Runs are capped at 10 candidates so discovery, Instagram checks, and scoring finish within the production time budget.
                </p>
              </div>

              {/* Scoring Model */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Scoring Model
                </label>
                <select
                  value={config.scoringModel}
                  onChange={(event) => setConfig({ ...config, scoringModel: event.target.value })}
                  disabled={loadingScoringModels}
                  className="w-full rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-950 disabled:opacity-60"
                >
                  {scoringModels.length > 0 ? (
                    scoringModels.map((model) => (
                      <option key={model.id} value={model.id}>{model.displayName}</option>
                    ))
                  ) : (
                    <option value={config.scoringModel}>
                      {loadingScoringModels ? "Loading current Anthropic models..." : config.scoringModel}
                    </option>
                  )}
                </select>
                <p className="text-xs text-gray-800 mt-1">
                  Loaded from Anthropic at runtime. Sonnet is the default; choose another available Claude model for this run.
                </p>
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
                onClick={() => handleRunResearch(true)}
                disabled={!!backgroundRunId || isResearching || !config.sportFocus}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                <span>🔬</span> Start Research
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Modal */}
      {showResultsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <span>✨</span> Research Results
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
                <div className="text-center py-12 text-gray-800">
                  <div className="text-4xl mb-3">🎉</div>
                  <p>All candidates processed!</p>
                </div>
              ) : (
                researchResults.map((candidate, index) => (
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
                              candidate.score >= 80
                                ? "bg-green-100 text-green-700"
                                : candidate.score >= 60
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            Score: {candidate.score}
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
