"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/browser";
import type { Athlete } from "@/lib/supabase/types";
import { formatNumber, formatDate, getStatusColor } from "@/lib/utils";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import AppointmentModal from "@/components/AppointmentModal";
import ContractModal from "@/components/ContractModal";
import { ComposeBox, OutcomeModal } from "@/components/conversations";
import type { BenchmarkMetrics } from "@/app/api/benchmarks/route";
import { sortInstagramPostsNewestFirst } from "@/lib/instagram-post-order";

interface Message {
  id: string;
  conversation_id: string;
  direction: "outbound" | "inbound";
  content: string;
  source: string;
  sent_by?: string;
  sent_at: string;
  read_at?: string;
}

interface Conversation {
  id: string;
  athlete_id: string;
  last_message_at?: string;
  unread_count: number;
}

interface ConversationOutcome {
  outcome: string;
  outcome_at: string;
  notes?: string;
}

interface InstagramData {
  // Basic
  ig_id?: string;
  username?: string;
  url?: string;
  full_name?: string;
  bio?: string;
  profile_pic_url?: string;
  profile_pic_hd?: string;

  // Metrics
  followers?: number;
  following?: number;
  posts?: number;
  highlights?: number;
  igtv_videos?: number;

  // Account flags
  verified?: boolean;
  private?: boolean;
  business?: boolean;
  business_category?: string;
  joined_recently?: boolean;
  has_channel?: boolean;

  // External links
  external_url?: string;
  external_urls?: Array<{ title: string; url: string; link_type: string }>;

  // Engagement metrics
  avg_likes?: number;
  avg_comments?: number;
  engagement_rate?: number;
  follower_following_ratio?: number;

  // Related profiles
  related_profiles?: Array<{ username: string; fullName: string; verified: boolean }>;

  // Latest posts
  latest_posts?: Array<{
    likes: number;
    comments: number;
    caption_preview: string;
    hashtags: string[];
    url: string;
  }>;

  // Metadata
  scraped_at?: string;
}

interface ContractData {
  year?: string;
  division?: string;
  of_username?: string;
  of_url?: string;
  contract_end?: string;
}

interface EnrichmentSourceRecord {
  source: "instagram" | "google" | "wikipedia" | "tiktok" | "onlyfans";
  status: "pending" | "running" | "complete" | "not_found" | "not_configured" | "failed";
  data: {
    title?: string;
    summary?: string;
    url?: string;
    handle?: string;
    displayName?: string;
    bio?: string;
    followers?: number;
    following?: number;
    likes?: number;
    videos?: number;
    verified?: boolean;
    exists?: boolean;
    username?: string;
    name?: string;
    snippet?: string;
    avatar?: string;
    price?: string | number | null;
    isFree?: boolean | null;
    subscribers?: number | null;
    posts?: number | null;
    photos?: number | null;
    audios?: number | null;
    joinDate?: string | null;
    location?: string | null;
    website?: string | null;
    lastSeen?: string | null;
    instagramUrl?: string | null;
    matchReason?: string | null;
    source?: string;
    provider?: string;
    message?: string;
    citations?: string[];
    alternatives?: Array<{ title?: string; url?: string }>;
    results?: Array<{ title?: string; url?: string; snippet?: string; date?: string }>;
  };
  fetched_at?: string | null;
  expires_at?: string | null;
  last_error?: string | null;
}

interface EnrichmentJob {
  id: string;
  source: EnrichmentSourceRecord["source"];
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  result?: Record<string, unknown>;
  last_error?: string | null;
}

async function waitForEnrichmentJob(jobId: string): Promise<EnrichmentJob> {
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`/api/enrichment/jobs?jobId=${jobId}`, { cache: "no-store" });
    const payload = (await response.json()) as { job?: EnrichmentJob; error?: string };
    if (!response.ok || !payload.job) {
      throw new Error(payload.error || "Could not read enrichment job status");
    }
    if (payload.job.status === "complete") return payload.job;
    if (payload.job.status === "failed" || payload.job.status === "cancelled") {
      throw new Error(payload.job.last_error || `Enrichment ${payload.job.status}`);
    }
  }
  throw new Error("Enrichment is still running in the background. You can safely return later.");
}

const PIPELINE_STAGES = {
  research: { label: "Research", color: "bg-purple-100 text-purple-800 border-purple-300", icon: "🔍" },
  approval: { label: "Pending Approval", color: "bg-blue-100 text-blue-800 border-blue-300", icon: "✅" },
  reach_out: { label: "Ready for Outreach", color: "bg-cyan-100 text-cyan-800 border-cyan-300", icon: "📤" },
  response: { label: "Awaiting Response", color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: "💬" },
  appointment: { label: "Appointment Set", color: "bg-orange-100 text-orange-800 border-orange-300", icon: "📅" },
  contract: { label: "Contract Signed", color: "bg-green-100 text-green-800 border-green-300", icon: "🎉" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-300", icon: "❌" },
};

function EnrichmentOutcome({
  label,
  record,
}: {
  label: string;
  record?: EnrichmentSourceRecord;
}) {
  if (!record) return null;

  const tone =
    record.status === "complete"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : record.status === "running" || record.status === "pending"
        ? "border-blue-200 bg-blue-50 text-blue-900"
      : record.status === "not_found"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : record.status === "not_configured"
          ? "border-slate-200 bg-slate-50 text-slate-800"
          : "border-red-200 bg-red-50 text-red-900";
  const statusLabel = record.status.replaceAll("_", " ");
  const fallbackMessage =
    record.status === "not_configured"
      ? `${label} is not configured for this request.`
      : record.status === "not_found"
        ? `${label} completed, but no verified match was found.`
        : record.status === "complete"
          ? `${label} completed successfully.`
          : `${label} could not be completed.`;

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{statusLabel}</span>
      </div>
      <p className="mt-1 leading-5">
        {record.data.message || record.last_error || fallbackMessage}
      </p>
      {record.fetched_at && (
        <p className="mt-1 text-xs opacity-70">Checked {formatDate(record.fetched_at)}</p>
      )}
    </div>
  );
}

function parseNotesData(notes: string | null): { instagram: InstagramData; contract: ContractData; other: string } {
  const result = {
    instagram: {} as InstagramData,
    contract: {} as ContractData,
    other: ""
  };

  if (!notes) return result;

  // Parse IG_DATA JSON - handle nested objects/arrays
  if (notes.includes("IG_DATA:")) {
    try {
      // Find the start of the JSON after IG_DATA:
      const igStart = notes.indexOf("IG_DATA:");
      if (igStart !== -1) {
        const jsonStart = notes.indexOf("{", igStart);
        if (jsonStart !== -1) {
          // Find matching closing brace by counting braces
          let braceCount = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < notes.length; i++) {
            if (notes[i] === "{") braceCount++;
            if (notes[i] === "}") braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
          const jsonStr = notes.substring(jsonStart, jsonEnd);
          result.instagram = JSON.parse(jsonStr);
        }
      }
    } catch (e) {
      console.error("Failed to parse IG data", e);
    }
  }

  // Parse all JSON objects in notes to find contract/OF data
  const jsonMatches = notes.match(/\{[^{}]+\}/g) || [];
  for (const jsonStr of jsonMatches) {
    try {
      const data = JSON.parse(jsonStr);
      // Extract contract/OF data from any JSON object that has these fields
      if (data.year && !result.contract.year) result.contract.year = data.year;
      if (data.division && !result.contract.division) result.contract.division = data.division;
      if (data.of_username && !result.contract.of_username) result.contract.of_username = data.of_username;
      if (data.of_url && !result.contract.of_url) result.contract.of_url = data.of_url;
      if (data.contract_end && !result.contract.contract_end) result.contract.contract_end = data.contract_end;
    } catch (e) {
      // Not valid JSON, skip
    }
  }

  // Also try to extract OF URL directly from notes
  if (!result.contract.of_url) {
    const ofUrlMatch = notes.match(/https:\/\/onlyfans\.com\/([a-zA-Z0-9_]+)/);
    if (ofUrlMatch) {
      result.contract.of_url = ofUrlMatch[0];
      if (!result.contract.of_username) {
        result.contract.of_username = ofUrlMatch[1];
      }
    }
  }

  // Check for Years: prefix
  if (notes.includes("Years:")) {
    const yearsMatch = notes.match(/Years:\s*([^|]+)/);
    if (yearsMatch && !result.contract.year) {
      result.contract.year = yearsMatch[1].trim();
    }
  }

  // Everything else goes to other
  result.other = notes
    .replace(/IG_DATA:\s*\{[^}]+\}/g, "")
    .replace(/\{[^{}]+\}/g, "")
    .replace(/Years:\s*[^|]+/g, "")
    .replace(/https:\/\/onlyfans\.com\/[a-zA-Z0-9_]+/g, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  return result;
}

export default function AthleteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enrichingSources, setEnrichingSources] = useState<
    Partial<Record<EnrichmentSourceRecord["source"], boolean>>
  >({});
  const [isEditing, setIsEditing] = useState(false);
  const [parsedData, setParsedData] = useState<ReturnType<typeof parseNotesData> | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"info" | "conversation">("info");

  // Conversation state
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [outcome, setOutcome] = useState<ConversationOutcome | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Editable fields
  const [editForm, setEditForm] = useState({
    name: "",
    sport: "",
    instagram_handle: "",
    instagram_url: "",
    email: "",
  });

  // Pipeline action states
  const [movingStage, setMovingStage] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);

  // Appointments and contracts state
  const [athleteAppointments, setAthleteAppointments] = useState<Array<{
    id: string;
    scheduled_at: string;
    status: string;
    location?: string;
    outcome?: string;
    notes?: string;
  }>>([]);
  const [athleteContracts, setAthleteContracts] = useState<Array<{
    id: string;
    status: string;
    contract_type: string;
    revenue_share_percent?: number;
    signed_at?: string;
    start_date?: string;
    end_date?: string;
    notes?: string;
  }>>([]);

  // Instagram photos state
  const [instagramPhotos, setInstagramPhotos] = useState<Array<{
    id: string;
    url: string;
    displayUrl: string;
    caption?: string;
    likesCount?: number;
    commentsCount?: number;
    timestamp?: string | null;
  }>>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [enrichmentSources, setEnrichmentSources] = useState<
    Partial<Record<EnrichmentSourceRecord["source"], EnrichmentSourceRecord>>
  >({});

  // Benchmark data for Fit Score
  const [benchmarks, setBenchmarks] = useState<BenchmarkMetrics | null>(null);

  useEffect(() => {
    async function fetchAthlete() {
      if (!params.id) return;

      try {
        const { data, error } = await supabase
          .from("athletes")
          .select("*")
          .eq("id", params.id)
          .single();

        if (error) throw error;
        setAthlete(data);
        setParsedData(parseNotesData(data?.notes));
        setEditForm({
          name: data?.name || "",
          sport: data?.sport || "",
          instagram_handle: data?.instagram_handle || "",
          instagram_url: data?.instagram_url || "",
          email: data?.email || "",
        });
      } catch (error) {
        console.error("Error fetching athlete:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchAthlete();
  }, [params.id]);

  // Auto-fetch photos when athlete loads
  useEffect(() => {
    if (athlete?.id) {
      // Fetch photos from database (they should already be there from research)
      fetch(`/api/instagram/photos?athleteId=${athlete.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.photos?.length > 0) {
            setInstagramPhotos(sortInstagramPostsNewestFirst(data.photos));
          }
        })
        .catch(err => console.error("Error loading photos:", err));
    }
  }, [athlete?.id]);

  useEffect(() => {
    if (!athlete?.id) return;

    fetch(`/api/athletes/${athlete.id}/enrich`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { sources?: EnrichmentSourceRecord[] }) => {
        const bySource = Object.fromEntries(
          (data.sources || []).map((record) => [record.source, record])
        );
        setEnrichmentSources(bySource);
      })
      .catch((error) => console.error("Error loading enrichment sources:", error));
  }, [athlete?.id]);

  // Reattach to any queued/running source jobs after navigation or refresh.
  useEffect(() => {
    if (!athlete?.id) return;
    let cancelled = false;

    fetch(`/api/enrichment/jobs?athleteId=${athlete.id}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { jobs?: EnrichmentJob[] }) => {
        const activeJobs = (payload.jobs || []).filter(
          (job) => job.status === "queued" || job.status === "running"
        );
        if (cancelled || activeJobs.length === 0) return;

        setEnrichingSources((current) => ({
          ...current,
          ...Object.fromEntries(activeJobs.map((job) => [job.source, true])),
        }));

        activeJobs.forEach((job) => {
          waitForEnrichmentJob(job.id)
            .catch((error) => console.error(`Background ${job.source} enrichment:`, error))
            .finally(() => {
              if (cancelled) return;
              setEnrichingSources((current) => ({ ...current, [job.source]: false }));
              fetch(`/api/athletes/${athlete.id}/enrich`, { cache: "no-store" })
                .then((response) => response.json())
                .then((data: { sources?: EnrichmentSourceRecord[] }) => {
                  if (!cancelled) {
                    setEnrichmentSources(Object.fromEntries(
                      (data.sources || []).map((record) => [record.source, record])
                    ));
                  }
                });
            });
        });
      })
      .catch((error) => console.error("Could not restore enrichment jobs:", error));

    return () => { cancelled = true; };
  }, [athlete?.id]);

  // Fetch benchmark data for Fit Score calculation
  useEffect(() => {
    fetch("/api/benchmarks")
      .then(res => res.json())
      .then(data => {
        if (data.benchmarks) {
          setBenchmarks(data.benchmarks);
        }
      })
      .catch(err => console.error("Error loading benchmarks:", err));
  }, []);

  // Fetch appointments and contracts for this athlete
  const fetchAppointmentsAndContracts = async () => {
    if (!athlete?.id) return;
    try {
      const [appointmentsRes, contractsRes] = await Promise.all([
        fetch(`/api/appointments?athlete_id=${athlete.id}`),
        fetch(`/api/contracts?athlete_id=${athlete.id}`),
      ]);
      const appointmentsData = await appointmentsRes.json();
      const contractsData = await contractsRes.json();
      setAthleteAppointments(appointmentsData.appointments || []);
      setAthleteContracts(contractsData.contracts || []);
    } catch (err) {
      console.error("Error loading appointments/contracts:", err);
    }
  };

  useEffect(() => {
    fetchAppointmentsAndContracts();
  }, [athlete?.id]);

  // Fetch conversation when tab changes
  useEffect(() => {
    async function fetchConversation() {
      if (!params.id || activeTab !== "conversation") return;

      try {
        // Get or create conversation
        const response = await fetch(`/api/conversations?athleteId=${params.id}`);
        const data = await response.json();

        if (data.conversations && data.conversations.length > 0) {
          const conv = data.conversations[0];
          setConversation(conv);

          // Fetch messages
          const messagesRes = await fetch(`/api/conversations/${conv.id}/messages`);
          const messagesData = await messagesRes.json();
          setMessages(messagesData.messages || []);

          // Fetch outcome
          const outcomeRes = await fetch(`/api/conversations/${conv.id}/outcome`);
          const outcomeData = await outcomeRes.json();
          setOutcome(outcomeData.outcome);
        }
      } catch (error) {
        console.error("Error fetching conversation:", error);
      }
    }

    fetchConversation();
  }, [params.id, activeTab]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch Instagram photos - first try database, if empty then scrape from Instagram
  async function fetchInstagramPhotos(forceScrape = false) {
    if (!athlete?.id) return;

    setPhotosLoading(true);
    setPhotosError(null);

    try {
      // First try to get from database (fast)
      if (!forceScrape) {
        const dbResponse = await fetch(`/api/instagram/photos?athleteId=${athlete.id}`);
        const dbData = await dbResponse.json();

        if (dbData.photos?.length > 0) {
          setInstagramPhotos(sortInstagramPostsNewestFirst(dbData.photos));
          setPhotosLoading(false);
          return;
        }
      }

      // If no photos or force scrape, use POST to fetch from Instagram
      setPhotosError("Fetching from Instagram...");

      const response = await fetch(`/api/instagram/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteId: athlete.id,
          limit: 10,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPhotosError(data.error || "Failed to fetch photos");
        return;
      }

      if (data.photos?.length > 0) {
        setInstagramPhotos(sortInstagramPostsNewestFirst(data.photos));
        setPhotosError(null);

        // Show success message with stats
        if (data.stats) {
          const msg = data.stats.new > 0
            ? `Loaded ${data.stats.new} new photo${data.stats.new > 1 ? "s" : ""} (${data.stats.total} total)`
            : data.stats.updated > 0
              ? `Refreshed dates and engagement for ${data.stats.updated} photo${data.stats.updated === 1 ? "" : "s"}`
              : `All ${data.stats.total} photos are current`;
          setMessage({ type: "success", text: msg });
        }
      } else {
        setPhotosError(data.message || "No photos available");
      }
    } catch (error) {
      console.error("Error fetching Instagram photos:", error);
      setPhotosError("Failed to load photos");
    } finally {
      setPhotosLoading(false);
    }
  }

  const handleStartConversation = async () => {
    if (!athlete) return;

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id }),
      });

      const data = await response.json();
      if (data.conversation) {
        setConversation(data.conversation);
      }
    } catch (error) {
      console.error("Error starting conversation:", error);
    }
  };

  const handleSendMessage = async (
    content: string,
    direction: "outbound" | "inbound" = "outbound",
    templateId?: string
  ) => {
    if (!conversation || !content.trim()) return;

    setSendingMessage(true);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          direction,
          source: "manual",
          sentBy: "User",
          templateId,
        }),
      });

      const data = await response.json();
      if (data.message) {
        setMessages([...messages, data.message]);
        setNewMessage("");
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSetOutcome = async (outcomeType: string) => {
    if (!conversation) return;

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: outcomeType,
          markedBy: "User",
        }),
      });

      const data = await response.json();
      if (data.outcome) {
        setOutcome(data.outcome);
        setMessage({ type: "success", text: `Marked as ${outcomeType}` });
      }
    } catch (error) {
      console.error("Error setting outcome:", error);
    }
  };

  const handleSave = async () => {
    if (!athlete) return;
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from("athletes")
        .update({
          name: editForm.name,
          sport: editForm.sport,
          instagram_handle: editForm.instagram_handle,
          instagram_url: editForm.instagram_url,
          email: editForm.email || null,
        })
        .eq("id", athlete.id);

      if (error) throw error;

      // Update local state
      setAthlete({
        ...athlete,
        ...editForm,
      });
      setIsEditing(false);
      setMessage({ type: "success", text: "Athlete saved successfully!" });
    } catch (error) {
      console.error("Error saving athlete:", error);
      setMessage({ type: "error", text: "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  };

  const handleEnrichFromSource = async (source: EnrichmentSourceRecord["source"]) => {
    if (!athlete) return;

    if (source === "instagram" && !athlete.instagram_handle) {
      setMessage({ type: "error", text: "No Instagram handle to enrich" });
      return;
    }

    setEnrichingSources((current) => ({ ...current, [source]: true }));
    setMessage(null);

    try {
      const response = await fetch("/api/enrichment/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id, source }),
      });

      const queued = (await response.json()) as { job?: EnrichmentJob; error?: string };

      if (!response.ok || !queued.job) {
        throw new Error(queued.error || `Could not queue ${source} enrichment`);
      }

      setMessage({
        type: "success",
        text: `${source} enrichment started. It will keep running if you leave this page.`,
      });

      const completedJob = await waitForEnrichmentJob(queued.job.id);
      const result = completedJob.result as {
        success?: boolean;
        status?: string;
        data?: { followers?: number; message?: string };
        error?: string;
      } | undefined;

      if (result?.success) {
        // Refresh the page data
        const { data } = await supabase
          .from("athletes")
          .select("*")
          .eq("id", athlete.id)
          .single();

        if (data) {
          setAthlete(data);
          setParsedData(parseNotesData(data.notes));
        }

        const sourceResponse = await fetch(`/api/athletes/${athlete.id}/enrich`, {
          cache: "no-store",
        });
        if (sourceResponse.ok) {
          const sourceData = (await sourceResponse.json()) as {
            sources?: EnrichmentSourceRecord[];
          };
          setEnrichmentSources(
            Object.fromEntries(
              (sourceData.sources || []).map((record) => [record.source, record])
            )
          );
        }

        const dataInfo = result.data;
        if (source === "instagram" && dataInfo?.followers) {
          setMessage({ type: "success", text: `Enriched from Instagram! ${dataInfo.followers.toLocaleString()} followers` });
        } else if (dataInfo?.message) {
          setMessage({
            type: result.status === "failed" || result.status === "not_configured" ? "error" : "success",
            text: dataInfo.message,
          });
        } else {
          setMessage({ type: "success", text: `Enriched from ${source}!` });
        }
      } else {
        throw new Error(result?.error || "Enrichment failed");
      }
    } catch (error) {
      console.error(`Error enriching from ${source}:`, error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : `Failed to enrich from ${source}.`,
      });
    } finally {
      setEnrichingSources((current) => ({ ...current, [source]: false }));
    }
  };

  const handleDelete = async () => {
    if (!athlete) return;
    if (!confirm(`Are you sure you want to delete ${athlete.name}?`)) return;

    try {
      const { error } = await supabase
        .from("athletes")
        .delete()
        .eq("id", athlete.id);

      if (error) throw error;
      router.push("/athletes");
    } catch (error) {
      console.error("Error deleting athlete:", error);
      setMessage({ type: "error", text: "Failed to delete athlete" });
    }
  };

  const handleResetEnrichment = async () => {
    if (!athlete) return;

    try {
      const { error } = await supabase
        .from("athletes")
        .update({
          enrichment_status: "pending",
          follower_count: null,
        })
        .eq("id", athlete.id);

      if (error) throw error;

      setAthlete({
        ...athlete,
        enrichment_status: "pending" as const,
        follower_count: null,
      });
      setMessage({ type: "success", text: "Reset to pending. Ready for re-enrichment." });
    } catch (error) {
      console.error("Error resetting:", error);
      setMessage({ type: "error", text: "Failed to reset status" });
    }
  };

  const handleMoveStage = async (newStage: string) => {
    if (!athlete) return;

    setMovingStage(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from("athletes")
        .update({ pipeline_stage: newStage })
        .eq("id", athlete.id);

      if (error) throw error;

      // Log pipeline history
      await supabase.from("pipeline_history").insert({
        athlete_id: athlete.id,
        from_stage: athlete.pipeline_stage,
        to_stage: newStage,
        changed_by: "dashboard_user",
        reason: "Manual stage change from athlete profile",
      });

      setAthlete({
        ...athlete,
        pipeline_stage: newStage,
      });

      const stageInfo = PIPELINE_STAGES[newStage as keyof typeof PIPELINE_STAGES];
      setMessage({ type: "success", text: `Moved to ${stageInfo?.label || newStage}` });
    } catch (error) {
      console.error("Error moving stage:", error);
      setMessage({ type: "error", text: "Failed to move to new stage" });
    } finally {
      setMovingStage(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading athlete...</div>
      </div>
    );
  }

  if (!athlete) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl text-gray-800">Athlete not found</h2>
        <Link href="/athletes" className="text-blue-600 hover:underline mt-4 inline-block">
          ← Back to athletes
        </Link>
      </div>
    );
  }

  const ig = parsedData?.instagram || {};
  const contract = parsedData?.contract || {};
  const googleData = enrichmentSources.google?.data;
  const wikipediaData = enrichmentSources.wikipedia?.status === "complete"
    ? enrichmentSources.wikipedia.data
    : undefined;
  const tiktokData = enrichmentSources.tiktok?.status === "complete"
    ? enrichmentSources.tiktok.data
    : undefined;
  const onlyFansData = enrichmentSources.onlyfans?.status === "complete"
    ? enrichmentSources.onlyfans.data
    : undefined;

  // Calculate engagement rate if we have the data
  const engagementSample = instagramPhotos.slice(0, 8);
  const recentAverageLikes = engagementSample.length > 0
    ? Math.round(engagementSample.reduce((sum, post) => sum + (post.likesCount || 0), 0) / engagementSample.length)
    : null;
  const recentAverageComments = engagementSample.length > 0
    ? Math.round(engagementSample.reduce((sum, post) => sum + (post.commentsCount || 0), 0) / engagementSample.length)
    : null;
  const engagementRate = engagementSample.length > 0 && athlete.follower_count
    ? (engagementSample.reduce((sum, p) => sum + (p.likesCount || 0) + (p.commentsCount || 0), 0) / engagementSample.length / athlete.follower_count * 100).toFixed(2)
    : null;

  return (
    <div className="space-y-6">
      {/* Message Banner */}
      {message && (
        <div className={`p-4 rounded-lg ${message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="float-right font-bold">×</button>
        </div>
      )}

      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="text-gray-700 hover:text-gray-900 font-medium"
      >
        ← Back
      </button>

      {/* Instagram-Style Profile Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Profile Picture */}
          <div className="flex-shrink-0">
            <img
              src={athlete.profile_pic_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(athlete.name)}&size=150&background=6366f1&color=fff`}
              alt={athlete.name}
              className="w-36 h-36 rounded-full object-cover border-4 border-gray-200"
              onError={(e) => {
                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(athlete.name)}&size=150&background=6366f1&color=fff`;
              }}
            />
          </div>

          {/* Profile Info */}
          <div className="flex-1 min-w-0">
            {/* Name Row with Actions */}
            <div className="flex flex-wrap items-center gap-3 mb-2">
              {isEditing ? (
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent"
                />
              ) : (
                <h1 className="text-2xl font-bold text-gray-900">{athlete.name}</h1>
              )}
              {ig.verified && (
                <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-medium">✓ Verified</span>
              )}

              {/* Edit / View IG - Right next to name */}
              {isEditing ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-green-600 text-white px-3 py-1.5 text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setEditForm({
                        name: athlete.name,
                        sport: athlete.sport,
                        instagram_handle: athlete.instagram_handle || "",
                        instagram_url: athlete.instagram_url || "",
                        email: athlete.email || "",
                      });
                    }}
                    className="bg-gray-200 text-gray-900 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="bg-gray-100 text-gray-900 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-200 font-medium"
                  >
                    Edit
                  </button>
                  {athlete.instagram_handle && (
                    <a
                      href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-3 py-1.5 text-sm rounded-lg hover:opacity-90 font-medium"
                    >
                      View IG
                    </a>
                  )}
                </>
              )}
            </div>

            {/* Instagram Handle & Sport */}
            <div className="flex items-center gap-4 text-gray-900 mb-3">
              {athlete.instagram_handle && (
                <span className="font-medium">@{athlete.instagram_handle}</span>
              )}
              <span className="px-2 py-0.5 bg-gray-100 rounded text-sm font-medium">{athlete.sport}</span>
              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${getStatusColor(athlete.enrichment_status)}`}>
                {athlete.enrichment_status}
              </span>
            </div>

            {/* Stats - Two Rows for Compact Layout */}
            <div className="space-y-2 mb-4">
              {/* Row 1 - Main Metrics */}
              <div className="flex flex-wrap gap-4">
                <div
                  className="text-center min-w-[60px]"
                  title="Average likes plus comments on the 8 newest non-pinned posts, divided by followers"
                >
                  <div className="text-lg font-bold text-gray-900">{formatNumber(athlete.follower_count)}</div>
                  <div className="text-xs text-gray-600">Followers</div>
                </div>
                <div className="text-center min-w-[60px]">
                  <div className="text-lg font-bold text-gray-900">{formatNumber(ig.following) || "—"}</div>
                  <div className="text-xs text-gray-600">Following</div>
                </div>
                <div className="text-center min-w-[60px]">
                  <div className="text-lg font-bold text-gray-900">{formatNumber(ig.posts) || "—"}</div>
                  <div className="text-xs text-gray-600">Posts</div>
                </div>
                <div className="text-center min-w-[60px]">
                  <div className="text-lg font-bold text-green-600">
                    {engagementRate
                      ? `${engagementRate}%`
                      : ig.engagement_rate
                        ? `${ig.engagement_rate}%`
                        : "—"}
                  </div>
                  <div className="text-xs text-gray-600">Engagement</div>
                </div>
              </div>
              {/* Row 2 - Secondary Metrics */}
              <div className="flex flex-wrap gap-4">
                <div className="text-center min-w-[60px]">
                  <div className="text-sm font-semibold text-gray-800">{formatNumber(recentAverageLikes ?? ig.avg_likes) || "—"}</div>
                  <div className="text-xs text-gray-500">Avg Likes</div>
                </div>
                <div className="text-center min-w-[60px]">
                  <div className="text-sm font-semibold text-gray-800">{formatNumber(recentAverageComments ?? ig.avg_comments) || "—"}</div>
                  <div className="text-xs text-gray-500">Avg Comments</div>
                </div>
                <div className="text-center min-w-[60px]">
                  <div className="text-sm font-semibold text-gray-800">{ig.highlights ? formatNumber(ig.highlights) : "—"}</div>
                  <div className="text-xs text-gray-500">Highlights</div>
                </div>
                <div className="text-center min-w-[60px]">
                  <div className="text-sm font-semibold text-gray-800">{ig.igtv_videos ? formatNumber(ig.igtv_videos) : "—"}</div>
                  <div className="text-xs text-gray-500">IGTV/Reels</div>
                </div>
              </div>
            </div>

            {/* Link in Bio */}
            {ig.external_url && (
              <div className="mb-4 flex items-center gap-2 flex-wrap">
                <span className="text-gray-700 font-medium text-sm">Link in Bio:</span>
                <a
                  href={ig.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium text-sm break-all"
                >
                  {ig.external_url}
                </a>
                {ig.external_url.toLowerCase().includes("onlyfans") && (
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded font-medium">
                    OnlyFans Link
                  </span>
                )}
                {(ig.external_url.toLowerCase().includes("linktree") || ig.external_url.toLowerCase().includes("linktr.ee")) && (
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
                    Linktree
                  </span>
                )}
              </div>
            )}

            {/* Bio - Directly under stats */}
            {ig.bio && (
              <p className="text-gray-900 whitespace-pre-wrap max-w-xl">{ig.bio}</p>
            )}

            {/* Account Status Tags */}
            <div className="flex flex-wrap gap-3 mt-4">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${ig.business ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}`}>
                {ig.business ? "Business Account" : "Personal Account"}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${ig.private ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>
                {ig.private ? "Private" : "Public"}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${ig.verified ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}`}>
                {ig.verified ? "✓ Verified" : "Not Verified"}
              </span>
            </div>
          </div>

          {/* Right Side - Fit Score & Follower Tier (Full Display) */}
          <div className="flex-shrink-0 flex flex-col gap-3 md:w-64">
            {/* Full Fit Score Display */}
            {benchmarks && (
              <FullFitScoreCard
                athlete={athlete}
                instagramData={ig}
                benchmarks={benchmarks}
              />
            )}
            {/* Full Follower Tier Display */}
            <FullTierCard followers={athlete.follower_count} />
          </div>
        </div>
      </div>

      {/* Pipeline Status & Actions Bar */}
      {athlete.pipeline_stage && (
        <div className="bg-white shadow rounded-lg p-4">
          {/* Top Row - Pipeline Status */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-900 font-medium">Pipeline Status:</span>
              <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                PIPELINE_STAGES[athlete.pipeline_stage as keyof typeof PIPELINE_STAGES]?.color || "bg-gray-100 text-gray-800"
              }`}>
                {PIPELINE_STAGES[athlete.pipeline_stage as keyof typeof PIPELINE_STAGES]?.icon}{" "}
                {PIPELINE_STAGES[athlete.pipeline_stage as keyof typeof PIPELINE_STAGES]?.label || athlete.pipeline_stage}
              </span>
            </div>

            {/* Move to any stage dropdown */}
            <select
              value=""
              onChange={(e) => e.target.value && handleMoveStage(e.target.value)}
              disabled={movingStage}
              className="text-sm border rounded-lg px-2 py-2 text-gray-900 bg-white hover:border-gray-400 disabled:opacity-50"
            >
              <option value="">Move to...</option>
              {Object.entries(PIPELINE_STAGES)
                .filter(([key]) => key !== athlete.pipeline_stage)
                .map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.icon} {value.label}
                  </option>
                ))}
            </select>
          </div>

          {/* Bottom Row - All Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t">
            {/* Stage-specific actions */}
            {athlete.pipeline_stage === "approval" && (
              <>
                <button
                  onClick={() => setShowApprovalModal(true)}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium"
                >
                  Approve
                </button>
                <button
                  onClick={() => setShowRejectionModal(true)}
                  className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 font-medium"
                >
                  Reject
                </button>
              </>
            )}
            {athlete.pipeline_stage === "reach_out" && (
              <button
                onClick={() => handleMoveStage("response")}
                disabled={movingStage}
                className="px-4 py-2 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 disabled:opacity-50 font-medium"
              >
                {movingStage ? "..." : "Mark as Contacted"}
              </button>
            )}
            {athlete.pipeline_stage === "response" && (
              <>
                <button
                  onClick={() => setShowAppointmentModal(true)}
                  className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 font-medium"
                >
                  Schedule Appointment
                </button>
                <button
                  onClick={() => handleMoveStage("rejected")}
                  disabled={movingStage}
                  className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 disabled:opacity-50 font-medium"
                >
                  Not Interested
                </button>
              </>
            )}
            {athlete.pipeline_stage === "appointment" && (
              <>
                <button
                  onClick={() => setShowContractModal(true)}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium"
                >
                  Create Contract
                </button>
                <button
                  onClick={() => handleMoveStage("rejected")}
                  disabled={movingStage}
                  className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 disabled:opacity-50 font-medium"
                >
                  Didn't Close
                </button>
              </>
            )}
            {athlete.pipeline_stage === "rejected" && (
              <button
                onClick={() => handleMoveStage("approval")}
                disabled={movingStage}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {movingStage ? "..." : "Reconsider"}
              </button>
            )}

            {/* Divider */}
            <div className="h-6 w-px bg-gray-300 mx-1" />

            {/* Common Actions - Always visible */}
            <button
              onClick={() => setShowAppointmentModal(true)}
              className="px-3 py-2 bg-orange-100 text-orange-700 text-sm rounded-lg hover:bg-orange-200 font-medium"
            >
              Schedule Appt
            </button>
            <button
              onClick={() => setShowContractModal(true)}
              className="px-3 py-2 bg-green-100 text-green-700 text-sm rounded-lg hover:bg-green-200 font-medium"
            >
              Create Contract
            </button>
            <button
              onClick={handleResetEnrichment}
              className="px-3 py-2 bg-yellow-100 text-yellow-800 text-sm rounded-lg hover:bg-yellow-200 font-medium"
            >
              Reset Status
            </button>
            <button
              onClick={handleDelete}
              className="px-3 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 font-medium"
            >
              Delete
            </button>

            {/* Appointments/Contracts Summary */}
            {(athleteAppointments.length > 0 || athleteContracts.length > 0) && (
              <>
                <div className="h-6 w-px bg-gray-300 mx-1" />
                {athleteAppointments.length > 0 && (
                  <span className="px-2 py-1 bg-orange-50 text-orange-700 text-xs rounded font-medium">
                    {athleteAppointments.length} appt{athleteAppointments.length > 1 ? "s" : ""}
                  </span>
                )}
                {athleteContracts.length > 0 && (
                  <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded font-medium">
                    {athleteContracts.length} contract{athleteContracts.length > 1 ? "s" : ""}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Appointments & Contracts Section - Visible Management */}
      {(athleteAppointments.length > 0 || athleteContracts.length > 0) && (
        <div className="bg-white shadow rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Appointments Column */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <span className="text-orange-500">📅</span> Appointments
                  {athleteAppointments.length > 0 && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                      {athleteAppointments.length}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => setShowAppointmentModal(true)}
                  className="text-xs text-orange-600 hover:text-orange-800 font-medium"
                >
                  + Add New
                </button>
              </div>
              {athleteAppointments.length > 0 ? (
                <div className="space-y-2">
                  {athleteAppointments.map((appt) => (
                    <div key={appt.id} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium text-gray-900 text-sm">
                            {new Date(appt.scheduled_at).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit"
                            })}
                          </div>
                          {appt.notes && (
                            <div className="text-xs text-gray-600 mt-1">{appt.notes}</div>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          appt.status === "completed" ? "bg-green-100 text-green-700" :
                          appt.status === "scheduled" ? "bg-blue-100 text-blue-700" :
                          appt.status === "cancelled" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {appt.status}
                        </span>
                      </div>
                      {appt.outcome && (
                        <div className="mt-2 pt-2 border-t border-orange-200 text-xs">
                          <span className="text-gray-500">Outcome:</span>{" "}
                          <span className={`font-medium ${
                            appt.outcome === "successful" ? "text-green-600" :
                            appt.outcome === "no_show" ? "text-red-600" :
                            "text-gray-700"
                          }`}>
                            {appt.outcome.replace("_", " ")}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 text-center">
                  No appointments scheduled
                </div>
              )}
            </div>

            {/* Contracts Column */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <span className="text-green-500">📝</span> Contracts
                  {athleteContracts.length > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      {athleteContracts.length}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => setShowContractModal(true)}
                  className="text-xs text-green-600 hover:text-green-800 font-medium"
                >
                  + Add New
                </button>
              </div>
              {athleteContracts.length > 0 ? (
                <div className="space-y-2">
                  {athleteContracts.map((contract) => (
                    <div key={contract.id} className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium text-gray-900 text-sm capitalize">
                            {contract.contract_type} Contract
                          </div>
                          {contract.revenue_share_percent && (
                            <div className="text-xs text-gray-600 mt-1">
                              {contract.revenue_share_percent}% revenue share
                            </div>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          contract.status === "signed" ? "bg-green-100 text-green-700" :
                          contract.status === "sent" ? "bg-blue-100 text-blue-700" :
                          contract.status === "draft" ? "bg-gray-100 text-gray-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {contract.status}
                        </span>
                      </div>
                      <div className="mt-2 pt-2 border-t border-green-200 text-xs grid grid-cols-2 gap-2">
                        {contract.start_date && (
                          <div>
                            <span className="text-gray-500">Start:</span>{" "}
                            <span className="font-medium">{new Date(contract.start_date).toLocaleDateString()}</span>
                          </div>
                        )}
                        {contract.end_date && (
                          <div>
                            <span className="text-gray-500">End:</span>{" "}
                            <span className="font-medium">{new Date(contract.end_date).toLocaleDateString()}</span>
                          </div>
                        )}
                        {contract.signed_at && (
                          <div className="col-span-2 text-green-600">
                            <span className="text-green-500">✓</span> Signed {new Date(contract.signed_at).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      {contract.notes && (
                        <div className="mt-2 text-xs text-gray-600">{contract.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 text-center">
                  No contracts created
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Selector - Right after Pipeline Status */}
      <div className="bg-white shadow rounded-lg">
        <nav className="flex">
          <button
            onClick={() => setActiveTab("info")}
            className={`flex-1 py-3 px-4 text-center font-medium text-sm border-b-2 transition-colors ${
              activeTab === "info"
                ? "border-blue-500 text-blue-600 bg-blue-50/50"
                : "border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50"
            }`}
          >
            Profile Info
          </button>
          <button
            onClick={() => setActiveTab("conversation")}
            className={`flex-1 py-3 px-4 text-center font-medium text-sm border-b-2 transition-colors ${
              activeTab === "conversation"
                ? "border-blue-500 text-blue-600 bg-blue-50/50"
                : "border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50"
            }`}
          >
            Conversation
            {conversation && conversation.unread_count > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                {conversation.unread_count}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "info" ? (
      <>
      {/* Instagram Photos Gallery - Part of Profile Info tab */}
      {athlete.instagram_handle && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Instagram Photos</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleEnrichFromSource("instagram")}
                disabled={enrichingSources.instagram}
                className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50"
                title="Refresh profile counts and recent engagement metrics"
              >
                {enrichingSources.instagram ? "Refreshing Profile..." : "Refresh Profile"}
              </button>
              {instagramPhotos.length > 0 && (
                <button
                  onClick={() => fetchInstagramPhotos(true)}
                  disabled={photosLoading}
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  title="Fetch new photos from Instagram"
                >
                  {photosLoading ? "Fetching..." : "Refresh Photos"}
                </button>
              )}
              {instagramPhotos.length === 0 && (
                <button
                  onClick={() => fetchInstagramPhotos(true)}
                  disabled={photosLoading}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {photosLoading ? "Loading..." : "Load Photos"}
                </button>
              )}
            </div>
          </div>

          {photosError && (
            <div className={`text-sm mb-4 ${photosError.includes("Fetching") ? "text-blue-600" : "text-red-600"}`}>
              {photosError.includes("Fetching") && (
                <span className="inline-block animate-spin mr-2">*</span>
              )}
              {photosError}
            </div>
          )}

          {photosLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-square bg-gray-200 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : instagramPhotos.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {instagramPhotos.map((photo) => (
                <a
                  key={photo.id}
                  href={photo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all"
                >
                  <img
                    src={photo.displayUrl}
                    alt={photo.caption || "Instagram post"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {photo.timestamp && (
                    <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-[11px] font-medium text-white shadow-sm">
                      {formatDate(photo.timestamp)}
                    </span>
                  )}
                  {/* Always visible engagement overlay with a full-width engagement row. */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/85 to-black/70 p-2 text-white">
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {photo.likesCount !== undefined && (
                        <div className="min-w-0 rounded bg-white/15 px-1.5 py-1 text-center">
                          <span className="block text-[10px] uppercase tracking-wide text-white/65">Likes</span>
                          <span className="block font-semibold tabular-nums">{photo.likesCount.toLocaleString()}</span>
                        </div>
                      )}
                      {photo.commentsCount !== undefined && (
                        <div className="min-w-0 rounded bg-white/15 px-1.5 py-1 text-center">
                          <span className="block text-[10px] uppercase tracking-wide text-white/65">Comments</span>
                          <span className="block font-semibold tabular-nums">{photo.commentsCount.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    {photo.likesCount !== undefined && athlete.follower_count && (
                      <div className="mt-1 flex items-center justify-between rounded bg-emerald-500/90 px-2 py-1 text-xs">
                        <span className="font-medium">Engagement</span>
                        <span className="font-bold tabular-nums">
                          {(((photo.likesCount + (photo.commentsCount || 0)) / athlete.follower_count) * 100).toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
              <p>Click "Load Photos" to view @{athlete.instagram_handle}'s recent posts</p>
              <p className="text-xs mt-1">Review their content before making a decision</p>
            </div>
          )}
        </div>
      )}

      {/* Data Sections */}
      <div className="space-y-6">
          {/* Editable Fields */}
          {isEditing && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">✏️ Edit Athlete</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Sport</label>
                  <select
                    value={editForm.sport}
                    onChange={(e) => setEditForm({ ...editForm, sport: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="Combat">Combat</option>
                    <option value="Ball Sports">Ball Sports</option>
                    <option value="Motorsports">Motorsports</option>
                    <option value="Extreme Sports">Extreme Sports</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Instagram Handle</label>
                  <div className="flex">
                    <span className="bg-gray-100 border border-r-0 rounded-l-lg px-3 py-2 text-gray-800">@</span>
                    <input
                      type="text"
                      value={editForm.instagram_handle}
                      onChange={(e) => setEditForm({ ...editForm, instagram_handle: e.target.value.replace("@", "") })}
                      className="w-full border rounded-r-lg px-3 py-2"
                      placeholder="username"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Instagram URL</label>
                  <input
                    type="text"
                    value={editForm.instagram_url}
                    onChange={(e) => setEditForm({ ...editForm, instagram_url: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="https://instagram.com/..."
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-800 mb-1">Email</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="email@example.com"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Source-linked web and Wikipedia research */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-gray-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                🔍 Web / Wikipedia Research
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEnrichFromSource("google")}
                  disabled={enrichingSources.google}
                  className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
                >
                  {enrichingSources.google ? "Researching..." : "Web research"}
                </button>
                <button
                  onClick={() => handleEnrichFromSource("wikipedia")}
                  disabled={enrichingSources.wikipedia}
                  className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
                >
                  {enrichingSources.wikipedia ? "Loading..." : "Wikipedia"}
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="mb-5 grid gap-2 md:grid-cols-2">
                <EnrichmentOutcome label="Web research" record={enrichmentSources.google} />
                <EnrichmentOutcome label="Wikipedia" record={enrichmentSources.wikipedia} />
              </div>
              {(wikipediaData?.summary || googleData?.summary || googleData?.results?.length) ? (
                <div className="mb-5 space-y-4">
                  {wikipediaData?.summary && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-gray-950">
                          {wikipediaData.title || "Wikipedia summary"}
                        </h3>
                        {wikipediaData.url && (
                          <a
                            href={wikipediaData.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-sm font-medium text-blue-600 hover:underline"
                          >
                            View source →
                          </a>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-700">
                        {wikipediaData.summary}
                      </p>
                    </div>
                  )}

                  {googleData?.summary && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-blue-950">Current research summary</h3>
                        <span className="text-xs font-medium text-blue-700">
                          Google via Apify
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-blue-950/80">
                        {googleData.summary}
                      </p>
                    </div>
                  )}

                  {googleData?.results && googleData.results.length > 0 && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">Current web results</h3>
                        <span className="text-xs font-medium text-blue-700">Google via Apify</span>
                      </div>
                      <div className="space-y-2">
                        {googleData.results.slice(0, 5).map((result, index) => (
                          <a
                            key={`${result.url || result.title}-${index}`}
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-lg border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50"
                          >
                            <span className="text-sm font-medium text-blue-700">
                              {result.title || result.url}
                            </span>
                            {result.snippet && (
                              <span className="mt-1 block text-xs leading-5 text-gray-600">
                                {result.snippet}
                              </span>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mb-5 text-sm text-gray-600">
                  Run web research for current sources. Wikipedia is checked separately and only accepts an individual biography that matches this athlete.
                </p>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-700 font-medium">Sport:</span>
                  <span className="ml-2 font-bold text-gray-900">{athlete.sport}</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-700 font-medium">Source:</span>
                  <span className="ml-2 font-bold text-gray-900 capitalize">{athlete.source?.replace("_", " ") || "—"}</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-700 font-medium">Added:</span>
                  <span className="ml-2 font-bold text-gray-900">{formatDate(athlete.created_at)}</span>
                </div>
              </div>
              {athlete.email && (
                <div className="mt-4 bg-gray-50 rounded-lg p-3 text-sm">
                  <span className="text-gray-700 font-medium">Email:</span>
                  <span className="ml-2 font-bold text-gray-900">{athlete.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* TikTok Data Section */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-black flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                🎵 TikTok Data
              </h2>
              <button
                onClick={() => handleEnrichFromSource("tiktok")}
                disabled={enrichingSources.tiktok}
                className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
              >
                {enrichingSources.tiktok ? "Searching..." : "Search TikTok"}
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <EnrichmentOutcome label="TikTok" record={enrichmentSources.tiktok} />
              </div>
              {tiktokData?.handle ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-950">
                        {tiktokData.displayName || `@${tiktokData.handle}`}
                        {tiktokData.verified ? " ✓" : ""}
                      </p>
                      <p className="text-sm text-gray-600">@{tiktokData.handle}</p>
                    </div>
                    {tiktokData.url && (
                      <a
                        href={tiktokData.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        View TikTok →
                      </a>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div className="rounded-lg bg-gray-50 p-3"><span className="block text-gray-500">Followers</span><strong>{formatNumber(tiktokData.followers)}</strong></div>
                    <div className="rounded-lg bg-gray-50 p-3"><span className="block text-gray-500">Following</span><strong>{formatNumber(tiktokData.following)}</strong></div>
                    <div className="rounded-lg bg-gray-50 p-3"><span className="block text-gray-500">Likes</span><strong>{formatNumber(tiktokData.likes)}</strong></div>
                    <div className="rounded-lg bg-gray-50 p-3"><span className="block text-gray-500">Videos</span><strong>{formatNumber(tiktokData.videos)}</strong></div>
                  </div>
                  {tiktokData.bio && <p className="text-sm leading-6 text-gray-700">{tiktokData.bio}</p>}
                </div>
              ) : (
                <div className="text-center text-gray-700">
                  {enrichmentSources.tiktok?.status === "not_configured"
                    ? "TikTok profile loading and Google handle discovery need a valid Apify connection."
                    : enrichmentSources.tiktok?.status === "not_found"
                      ? "No verified TikTok profile was found for this athlete."
                    : "Search to discover and load this athlete's TikTok profile."}
                </div>
              )}
            </div>
          </div>

          {/* OnlyFans Data Section */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-blue-400 to-blue-600 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                💙 OnlyFans Data
              </h2>
              <button
                onClick={() => handleEnrichFromSource("onlyfans")}
                disabled={enrichingSources.onlyfans}
                className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
              >
                {enrichingSources.onlyfans ? "Checking..." : "Check OnlyFans"}
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <EnrichmentOutcome label="OnlyFans public discovery" record={enrichmentSources.onlyfans} />
              </div>
              {(onlyFansData?.url || contract.of_username || contract.of_url || contract.division) ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {onlyFansData?.url && (
                    <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="font-medium text-blue-950">
                        {onlyFansData.source === "existing_record"
                          ? "Stored profile"
                          : onlyFansData.source === "onlyfans_profile_actor"
                            ? "Exact username match from OnlyFans profile actor"
                          : onlyFansData.source === "onlyfans_discovery_actor"
                            ? "Matched by OnlyFans Discovery actor"
                            : "Matched by Google through Apify"}
                        {onlyFansData.verified ? " ✓" : ""}
                      </p>
                      {(onlyFansData.bio || onlyFansData.snippet) && (
                        <p className="mt-1 text-xs leading-5 text-blue-900/75">
                          {onlyFansData.bio || onlyFansData.snippet}
                        </p>
                      )}
                      <a
                        href={onlyFansData.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block font-medium text-blue-700 hover:underline"
                      >
                        Verify profile →
                      </a>
                    </div>
                  )}
                  {onlyFansData?.username && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Username</span>
                      <strong className="text-gray-950">@{onlyFansData.username}</strong>
                    </div>
                  )}
                  {onlyFansData?.price !== undefined && onlyFansData.price !== null && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Subscription</span>
                      <strong className="text-gray-950">
                        {onlyFansData.isFree
                          ? "Free"
                          : typeof onlyFansData.price === "number"
                            ? `$${onlyFansData.price.toFixed(2)}`
                            : String(onlyFansData.price)}
                      </strong>
                    </div>
                  )}
                  {onlyFansData?.subscribers !== undefined && onlyFansData.subscribers !== null && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Subscribers</span>
                      <strong className="text-gray-950">{formatNumber(onlyFansData.subscribers)}</strong>
                    </div>
                  )}
                  {onlyFansData?.likes !== undefined && onlyFansData.likes !== null && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Likes</span>
                      <strong className="text-gray-950">{formatNumber(onlyFansData.likes)}</strong>
                    </div>
                  )}
                  {onlyFansData?.posts !== undefined && onlyFansData.posts !== null && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Posts</span>
                      <strong className="text-gray-950">{formatNumber(onlyFansData.posts)}</strong>
                    </div>
                  )}
                  {onlyFansData?.photos !== undefined && onlyFansData.photos !== null && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Photos</span>
                      <strong className="text-gray-950">{formatNumber(onlyFansData.photos)}</strong>
                    </div>
                  )}
                  {onlyFansData?.videos !== undefined && onlyFansData.videos !== null && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <span className="block text-gray-600">Videos</span>
                      <strong className="text-gray-950">{formatNumber(onlyFansData.videos)}</strong>
                    </div>
                  )}
                  {onlyFansData?.instagramUrl && (
                    <div className="col-span-2 rounded-lg bg-gray-50 p-3">
                      <a
                        href={onlyFansData.instagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-700 hover:underline"
                      >
                        View linked Instagram →
                      </a>
                    </div>
                  )}
                  {contract.year && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <span className="text-gray-700 font-medium">Contract Year(s):</span>
                      <span className="ml-2 font-bold text-gray-900">{contract.year}</span>
                    </div>
                  )}
                  {contract.division && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <span className="text-gray-700 font-medium">Division / League:</span>
                      <span className="ml-2 font-bold text-gray-900">{contract.division}</span>
                    </div>
                  )}
                  {contract.of_username && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <span className="text-gray-700 font-medium">OF Username:</span>
                      <span className="ml-2 font-bold text-gray-900">@{contract.of_username}</span>
                    </div>
                  )}
                  {contract.contract_end && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <span className="text-gray-700 font-medium">Contract End:</span>
                      <span className="ml-2 font-bold text-gray-900">{contract.contract_end}</span>
                    </div>
                  )}
                  {contract.of_url && (
                    <div className="col-span-2">
                      <a
                        href={contract.of_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium"
                      >
                        View OnlyFans Profile →
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-700">
                  {enrichmentSources.onlyfans?.status === "not_configured"
                    ? "OnlyFans discovery uses the configured Apify actor and Google fallback, and needs a valid Apify connection."
                    : enrichmentSources.onlyfans?.status === "not_found"
                      ? "No public OnlyFans result was found."
                      : "Check public search results for a possible OnlyFans presence."}
                </div>
              )}
            </div>
          </div>

          {/* All Data Points - Collapsible Raw View */}
          <details className="bg-white shadow rounded-lg overflow-hidden">
            <summary className="px-6 py-4 bg-gray-100 cursor-pointer hover:bg-gray-200 font-semibold text-gray-900">
              📋 View All Raw Data Points
            </summary>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-gray-900 font-semibold">Field</th>
                      <th className="text-left py-2 text-gray-900 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <DataRow label="ID" value={athlete.id} />
                    <DataRow label="Name" value={athlete.name} />
                    <DataRow label="Sport" value={athlete.sport} />
                    <DataRow label="Instagram Handle" value={athlete.instagram_handle} />
                    <DataRow label="Instagram URL" value={athlete.instagram_url} />
                    <DataRow label="Email" value={athlete.email} />
                    <DataRow label="Follower Count" value={athlete.follower_count?.toLocaleString()} />
                    <DataRow label="Profile Pic URL" value={athlete.profile_pic_url} truncate />
                    <DataRow label="Enrichment Status" value={athlete.enrichment_status} />
                    <DataRow label="Source" value={athlete.source} />
                    <DataRow label="Created" value={formatDate(athlete.created_at)} />
                    <DataRow label="Updated" value={athlete.updated_at ? formatDate(athlete.updated_at) : null} />
                    <DataRow label="IG Following" value={ig.following?.toLocaleString()} />
                    <DataRow label="IG Posts" value={ig.posts?.toLocaleString()} />
                    <DataRow label="IG Verified" value={ig.verified ? "Yes" : "No"} />
                    <DataRow label="IG Private" value={ig.private ? "Yes" : "No"} />
                    <DataRow label="IG Business" value={ig.business ? "Yes" : "No"} />
                    <DataRow label="IG Full Name" value={ig.full_name} />
                    <DataRow label="IG Bio" value={ig.bio} truncate />
                    <DataRow label="Contract Year" value={contract.year} />
                    <DataRow label="Division" value={contract.division} />
                    <DataRow label="OF Username" value={contract.of_username} />
                    <DataRow label="OF URL" value={contract.of_url} truncate />
                    <DataRow label="Contract End" value={contract.contract_end} />
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          {/* Notes / Raw Data */}
          {parsedData?.other && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Notes</h2>
              <p className="text-gray-800">{parsedData.other}</p>
            </div>
          )}
        </div>
      </>
      ) : (
        /* Conversation Tab */
        <div className="bg-white shadow rounded-lg">
          {/* Outcome Buttons */}
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-800">Mark outcome:</span>
              {["positive", "negative", "question", "converted"].map((outcomeType) => (
                <button
                  key={outcomeType}
                  onClick={() => handleSetOutcome(outcomeType)}
                  disabled={!conversation}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    outcome?.outcome === outcomeType
                      ? outcomeType === "positive" || outcomeType === "converted"
                        ? "bg-green-100 border-green-500 text-green-700"
                        : outcomeType === "negative"
                        ? "bg-red-100 border-red-500 text-red-700"
                        : "bg-yellow-100 border-yellow-500 text-yellow-700"
                      : "border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {outcomeType === "positive" && "Positive"}
                  {outcomeType === "negative" && "Negative"}
                  {outcomeType === "question" && "Question"}
                  {outcomeType === "converted" && "Converted"}
                </button>
              ))}
            </div>
            {outcome && (
              <span className="text-xs text-gray-800">
                Last updated: {new Date(outcome.outcome_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Messages Container - iOS Style */}
          <div className="h-96 overflow-y-auto p-4 bg-gray-50">
            {!conversation ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-800">
                <p className="mb-4">No conversation started yet</p>
                <button
                  onClick={handleStartConversation}
                  className="bg-blue-600 text-white px-6 py-2 rounded-full hover:bg-blue-700"
                >
                  Start Conversation
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-800">
                <p>No messages yet. Send the first message below.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        msg.direction === "outbound"
                          ? "bg-blue-500 text-white rounded-br-md"
                          : "bg-white text-gray-900 border rounded-bl-md"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <div
                        className={`text-xs mt-1 ${
                          msg.direction === "outbound" ? "text-blue-100" : "text-gray-600"
                        }`}
                      >
                        {msg.source === "agent_generated" && "Agent "}
                        {msg.source === "manual" && msg.sent_by && `${msg.sent_by} `}
                        {new Date(msg.sent_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Message Input */}
          <ComposeBox
            onSend={handleSendMessage}
            disabled={!conversation}
            athleteData={{
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle || undefined,
              follower_count: athlete.follower_count || undefined,
            }}
            placeholder="Type a message to log..."
          />
        </div>
      )}

      {/* Approval Modal */}
      {athlete && (
        <ApprovalModal
          athlete={athlete}
          isOpen={showApprovalModal}
          onClose={() => setShowApprovalModal(false)}
          onComplete={() => {
            setShowApprovalModal(false);
            // Navigate back to approval queue to continue reviewing
            router.push("/approve");
          }}
        />
      )}

      {/* Rejection Modal */}
      {athlete && (
        <RejectionModal
          athlete={athlete}
          isOpen={showRejectionModal}
          onClose={() => setShowRejectionModal(false)}
          onComplete={() => {
            setShowRejectionModal(false);
            // Navigate back to approval queue to continue reviewing
            router.push("/approve");
          }}
        />
      )}

      {/* Appointment Modal */}
      {athlete && (
        <AppointmentModal
          athlete={athlete}
          isOpen={showAppointmentModal}
          onClose={() => setShowAppointmentModal(false)}
          onComplete={() => {
            setShowAppointmentModal(false);
            fetchAppointmentsAndContracts();
            setMessage({ type: "success", text: "Appointment scheduled!" });
          }}
        />
      )}

      {/* Contract Modal */}
      {athlete && (
        <ContractModal
          athlete={athlete}
          isOpen={showContractModal}
          onClose={() => setShowContractModal(false)}
          onComplete={() => {
            setShowContractModal(false);
            fetchAppointmentsAndContracts();
            setMessage({ type: "success", text: "Contract created!" });
          }}
        />
      )}
    </div>
  );
}

function DataCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-700 font-medium">{label}</div>
    </div>
  );
}

function StatBox({ label, value, icon, sublabel }: { label: string; value: string; icon: string; sublabel?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-700 font-medium">{label}</div>
      {sublabel && <div className="text-xs text-gray-700">{sublabel}</div>}
    </div>
  );
}

function DataRow({ label, value, truncate }: { label: string; value: string | number | null | undefined; truncate?: boolean }) {
  if (value === null || value === undefined || value === "") {
    return (
      <tr>
        <td className="py-2 text-gray-700 font-medium">{label}</td>
        <td className="py-2 text-gray-500 italic">—</td>
      </tr>
    );
  }

  const displayValue = String(value);
  const isUrl = displayValue.startsWith("http");

  return (
    <tr>
      <td className="py-2 text-gray-700 font-medium">{label}</td>
      <td className="py-2 text-gray-900">
        {isUrl ? (
          <a
            href={displayValue}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
            title={displayValue}
          >
            {truncate && displayValue.length > 50
              ? displayValue.substring(0, 50) + "..."
              : displayValue}
          </a>
        ) : truncate && displayValue.length > 100 ? (
          <span title={displayValue}>{displayValue.substring(0, 100)}...</span>
        ) : (
          displayValue
        )}
      </td>
    </tr>
  );
}

function TierBadge({ followers }: { followers: number | null }) {
  if (!followers) {
    return <div className="text-gray-800">No data</div>;
  }

  let tier = "";
  let color = "";
  let description = "";

  if (followers >= 5000000) {
    tier = "🏆 Mega Star";
    color = "bg-yellow-100 text-yellow-800 border-yellow-300";
    description = "5M+ followers - Marquee signing";
  } else if (followers >= 1000000) {
    tier = "⭐ Star";
    color = "bg-purple-100 text-purple-800 border-purple-300";
    description = "1M-5M followers - Major talent";
  } else if (followers >= 500000) {
    tier = "🔥 Rising Star";
    color = "bg-orange-100 text-orange-800 border-orange-300";
    description = "500K-1M followers - High potential";
  } else if (followers >= 100000) {
    tier = "💎 Sweet Spot";
    color = "bg-green-100 text-green-800 border-green-300";
    description = "100K-500K - OF's target range";
  } else if (followers >= 50000) {
    tier = "📈 Growing";
    color = "bg-blue-100 text-blue-800 border-blue-300";
    description = "50K-100K - Emerging talent";
  } else {
    tier = "🌱 Micro";
    color = "bg-gray-100 text-gray-800 border-gray-300";
    description = "Under 50K - Niche reach";
  }

  return (
    <div className={`${color} border rounded-lg p-4 text-center`}>
      <div className="text-xl font-bold">{tier}</div>
      <div className="text-sm mt-1">{description}</div>
      <div className="text-xs mt-2 opacity-75">{followers.toLocaleString()} followers</div>
    </div>
  );
}

// Fit Score Card Component
function FitScoreCard({
  athlete,
  instagramData,
  benchmarks,
}: {
  athlete: Athlete;
  instagramData: InstagramData;
  benchmarks: BenchmarkMetrics;
}) {
  // Calculate individual metric scores
  const metrics: Array<{
    label: string;
    value: number | null;
    benchmark: number;
    status: "excellent" | "good" | "below" | "na";
    comparison: string;
  }> = [];

  // Followers - check if in ideal range
  if (athlete.follower_count) {
    const { low, ideal_min, ideal_max, high } = benchmarks.thresholds.followers;
    let status: "excellent" | "good" | "below" = "below";
    let comparison = "";

    if (athlete.follower_count >= ideal_min && athlete.follower_count <= ideal_max) {
      status = "excellent";
      comparison = "In ideal range";
    } else if (athlete.follower_count > ideal_max) {
      status = "good";
      comparison = `Above avg (${formatNumber(benchmarks.medianFollowers)})`;
    } else if (athlete.follower_count >= low) {
      status = "good";
      comparison = `Near avg (${formatNumber(benchmarks.medianFollowers)})`;
    } else {
      status = "below";
      comparison = `Below avg (${formatNumber(benchmarks.medianFollowers)})`;
    }

    metrics.push({
      label: "Followers",
      value: athlete.follower_count,
      benchmark: benchmarks.medianFollowers,
      status,
      comparison,
    });
  }

  // Follower/Following Ratio
  const ratio = instagramData.follower_following_ratio ||
    (instagramData.following && athlete.follower_count
      ? athlete.follower_count / instagramData.following
      : null);

  if (ratio) {
    const { poor, good, excellent } = benchmarks.thresholds.ratio;
    let status: "excellent" | "good" | "below" = "below";

    if (ratio >= excellent) {
      status = "excellent";
    } else if (ratio >= good) {
      status = "good";
    } else {
      status = "below";
    }

    metrics.push({
      label: "Ratio",
      value: ratio,
      benchmark: benchmarks.avgRatio,
      status,
      comparison: `${status === "excellent" ? "Excellent" : status === "good" ? "Good" : "Below"} (avg: ${benchmarks.avgRatio}x)`,
    });
  }

  // Engagement Rate
  if (instagramData.engagement_rate) {
    const { poor, good, excellent } = benchmarks.thresholds.engagement;
    let status: "excellent" | "good" | "below" = "below";

    if (instagramData.engagement_rate >= excellent) {
      status = "excellent";
    } else if (instagramData.engagement_rate >= good) {
      status = "good";
    } else {
      status = "below";
    }

    metrics.push({
      label: "Engagement",
      value: instagramData.engagement_rate,
      benchmark: benchmarks.avgEngagementRate,
      status,
      comparison: `${instagramData.engagement_rate}% vs ${benchmarks.avgEngagementRate}% avg`,
    });
  }

  // Posts count
  if (instagramData.posts) {
    const status = instagramData.posts >= benchmarks.avgPosts * 0.5 ? "good" : "below";
    metrics.push({
      label: "Posts",
      value: instagramData.posts,
      benchmark: benchmarks.avgPosts,
      status,
      comparison: `${instagramData.posts} vs ${benchmarks.avgPosts} avg`,
    });
  }

  // Account type (business is preferred)
  if (instagramData.business !== undefined) {
    metrics.push({
      label: "Business",
      value: instagramData.business ? 1 : 0,
      benchmark: benchmarks.businessPercent,
      status: instagramData.business ? "excellent" : "good",
      comparison: instagramData.business ? "Business Account" : "Personal Account",
    });
  }

  // Calculate overall fit score
  const scoredMetrics = metrics.filter(m => m.status !== "na");
  const excellentCount = scoredMetrics.filter(m => m.status === "excellent").length;
  const goodCount = scoredMetrics.filter(m => m.status === "good").length;
  const belowCount = scoredMetrics.filter(m => m.status === "below").length;

  // Score: excellent = 100, good = 70, below = 30
  const totalScore = scoredMetrics.length > 0
    ? Math.round(
        ((excellentCount * 100) + (goodCount * 70) + (belowCount * 30)) / scoredMetrics.length
      )
    : 0;

  // Determine overall grade
  let grade = "";
  let gradeColor = "";
  if (totalScore >= 85) {
    grade = "A";
    gradeColor = "text-green-600 bg-green-100";
  } else if (totalScore >= 70) {
    grade = "B";
    gradeColor = "text-blue-600 bg-blue-100";
  } else if (totalScore >= 55) {
    grade = "C";
    gradeColor = "text-yellow-600 bg-yellow-100";
  } else {
    grade = "D";
    gradeColor = "text-red-600 bg-red-100";
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600">
        <h2 className="text-lg font-semibold text-white">Fit Score</h2>
        <p className="text-xs text-white/70">Based on {benchmarks.totalAthletes} historical athletes</p>
      </div>

      <div className="p-6">
        {/* Overall Score Circle */}
        <div className="flex items-center justify-center mb-6">
          <div className={`w-24 h-24 rounded-full ${gradeColor} flex flex-col items-center justify-center border-4 border-current`}>
            <span className="text-3xl font-bold">{grade}</span>
            <span className="text-sm font-medium">{totalScore}%</span>
          </div>
        </div>

        {/* Metric Breakdown */}
        <div className="space-y-3">
          {metrics.map((metric, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-sm text-gray-700 font-medium">{metric.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">{metric.comparison}</span>
                <span className={`w-3 h-3 rounded-full ${
                  metric.status === "excellent"
                    ? "bg-green-500"
                    : metric.status === "good"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`} />
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t flex justify-center gap-4 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Excellent
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" /> Good
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Below
          </span>
        </div>

        {/* Quick Summary */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-600">
            {excellentCount > 0 && `${excellentCount} excellent`}
            {excellentCount > 0 && goodCount > 0 && ", "}
            {goodCount > 0 && `${goodCount} good`}
            {(excellentCount > 0 || goodCount > 0) && belowCount > 0 && ", "}
            {belowCount > 0 && `${belowCount} below avg`}
          </p>
        </div>
      </div>
    </div>
  );
}

// Full Fit Score Card - displays all info directly
function FullFitScoreCard({
  athlete,
  instagramData,
  benchmarks,
}: {
  athlete: Athlete;
  instagramData: InstagramData;
  benchmarks: BenchmarkMetrics;
}) {
  const metricDetails: Array<{ label: string; status: "excellent" | "good" | "below"; value: string }> = [];

  if (athlete.follower_count) {
    const { ideal_min, ideal_max, low } = benchmarks.thresholds.followers;
    let status: "excellent" | "good" | "below" = "below";
    if (athlete.follower_count >= ideal_min && athlete.follower_count <= ideal_max) {
      status = "excellent";
    } else if (athlete.follower_count >= low) {
      status = "good";
    }
    metricDetails.push({ label: "Followers", status, value: formatNumber(athlete.follower_count) || "—" });
  }

  const ratio = instagramData.follower_following_ratio ||
    (instagramData.following && athlete.follower_count ? athlete.follower_count / instagramData.following : null);
  if (ratio) {
    const { good, excellent } = benchmarks.thresholds.ratio;
    let status: "excellent" | "good" | "below" = "below";
    if (ratio >= excellent) status = "excellent";
    else if (ratio >= good) status = "good";
    metricDetails.push({ label: "Ratio", status, value: `${ratio.toFixed(1)}x` });
  }

  if (instagramData.engagement_rate) {
    const { good, excellent } = benchmarks.thresholds.engagement;
    let status: "excellent" | "good" | "below" = "below";
    if (instagramData.engagement_rate >= excellent) status = "excellent";
    else if (instagramData.engagement_rate >= good) status = "good";
    metricDetails.push({ label: "Engagement", status, value: `${instagramData.engagement_rate}%` });
  }

  const excellentCount = metricDetails.filter(m => m.status === "excellent").length;
  const goodCount = metricDetails.filter(m => m.status === "good").length;
  const belowCount = metricDetails.filter(m => m.status === "below").length;

  const totalScore = metricDetails.length > 0
    ? Math.round(((excellentCount * 100) + (goodCount * 70) + (belowCount * 30)) / metricDetails.length)
    : 0;

  let grade = "";
  let gradeColor = "";
  let gradeBg = "";
  if (totalScore >= 85) { grade = "A"; gradeColor = "text-green-600"; gradeBg = "bg-green-100"; }
  else if (totalScore >= 70) { grade = "B"; gradeColor = "text-blue-600"; gradeBg = "bg-blue-100"; }
  else if (totalScore >= 55) { grade = "C"; gradeColor = "text-yellow-600"; gradeBg = "bg-yellow-100"; }
  else { grade = "D"; gradeColor = "text-red-600"; gradeBg = "bg-red-100"; }

  return (
    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg p-3 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium opacity-80">Fit Score</span>
        <span className="text-xs opacity-60">{benchmarks.totalAthletes} athletes</span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-12 h-12 rounded-full ${gradeBg} ${gradeColor} flex flex-col items-center justify-center font-bold`}>
          <span className="text-xl">{grade}</span>
        </div>
        <div>
          <div className="text-2xl font-bold">{totalScore}%</div>
        </div>
      </div>
      {/* Metric breakdown - always visible */}
      <div className="space-y-1 pt-2 border-t border-white/20">
        {metricDetails.map((m, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="opacity-80">{m.label}</span>
            <div className="flex items-center gap-1">
              <span className="font-medium">{m.value}</span>
              <span className={`w-2 h-2 rounded-full ${
                m.status === "excellent" ? "bg-green-400" :
                m.status === "good" ? "bg-yellow-400" : "bg-red-400"
              }`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Full Follower Tier Card - displays all info directly
function FullTierCard({ followers }: { followers: number | null }) {
  if (!followers) {
    return (
      <div className="bg-gray-100 rounded-lg p-3 text-center">
        <div className="text-xs text-gray-500">Follower Tier</div>
        <div className="text-sm text-gray-400">No data</div>
      </div>
    );
  }

  let tier = "";
  let icon = "";
  let color = "";
  let description = "";
  let range = "";

  if (followers >= 5000000) {
    tier = "Mega Star"; icon = "🏆"; color = "bg-yellow-100 border-yellow-400 text-yellow-800";
    description = "Marquee signing"; range = "5M+";
  } else if (followers >= 1000000) {
    tier = "Star"; icon = "⭐"; color = "bg-purple-100 border-purple-400 text-purple-800";
    description = "Major talent"; range = "1M-5M";
  } else if (followers >= 500000) {
    tier = "Rising Star"; icon = "🔥"; color = "bg-orange-100 border-orange-400 text-orange-800";
    description = "High potential"; range = "500K-1M";
  } else if (followers >= 100000) {
    tier = "Sweet Spot"; icon = "💎"; color = "bg-green-100 border-green-400 text-green-800";
    description = "Ideal OF range"; range = "100K-500K";
  } else if (followers >= 50000) {
    tier = "Growing"; icon = "📈"; color = "bg-blue-100 border-blue-400 text-blue-800";
    description = "Emerging"; range = "50K-100K";
  } else {
    tier = "Micro"; icon = "🌱"; color = "bg-gray-100 border-gray-400 text-gray-800";
    description = "Niche reach"; range = "<50K";
  }

  return (
    <div className={`${color} border-2 rounded-lg p-3`}>
      <div className="text-xs font-medium opacity-70 mb-1">Follower Tier</div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="font-bold">{tier}</div>
          <div className="text-xs opacity-75">{description}</div>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-current/20 flex justify-between text-xs">
        <span className="opacity-70">Range: {range}</span>
        <span className="font-medium">{followers.toLocaleString()}</span>
      </div>
    </div>
  );
}

// Compact Fit Score for header with hover tooltip
function CompactFitScore({
  athlete,
  instagramData,
  benchmarks,
}: {
  athlete: Athlete;
  instagramData: InstagramData;
  benchmarks: BenchmarkMetrics;
}) {
  // Calculate score (simplified version)
  const metricDetails: Array<{ label: string; status: "excellent" | "good" | "below"; value: string }> = [];

  if (athlete.follower_count) {
    const { ideal_min, ideal_max, low } = benchmarks.thresholds.followers;
    let status: "excellent" | "good" | "below" = "below";
    if (athlete.follower_count >= ideal_min && athlete.follower_count <= ideal_max) {
      status = "excellent";
    } else if (athlete.follower_count >= low) {
      status = "good";
    }
    metricDetails.push({ label: "Followers", status, value: formatNumber(athlete.follower_count) || "—" });
  }

  const ratio = instagramData.follower_following_ratio ||
    (instagramData.following && athlete.follower_count ? athlete.follower_count / instagramData.following : null);
  if (ratio) {
    const { good, excellent } = benchmarks.thresholds.ratio;
    let status: "excellent" | "good" | "below" = "below";
    if (ratio >= excellent) status = "excellent";
    else if (ratio >= good) status = "good";
    metricDetails.push({ label: "Ratio", status, value: `${ratio.toFixed(1)}x` });
  }

  if (instagramData.engagement_rate) {
    const { good, excellent } = benchmarks.thresholds.engagement;
    let status: "excellent" | "good" | "below" = "below";
    if (instagramData.engagement_rate >= excellent) status = "excellent";
    else if (instagramData.engagement_rate >= good) status = "good";
    metricDetails.push({ label: "Engagement", status, value: `${instagramData.engagement_rate}%` });
  }

  const excellentCount = metricDetails.filter(m => m.status === "excellent").length;
  const goodCount = metricDetails.filter(m => m.status === "good").length;
  const belowCount = metricDetails.filter(m => m.status === "below").length;

  const totalScore = metricDetails.length > 0
    ? Math.round(((excellentCount * 100) + (goodCount * 70) + (belowCount * 30)) / metricDetails.length)
    : 0;

  let grade = "";
  let gradeColor = "";
  if (totalScore >= 85) { grade = "A"; gradeColor = "bg-green-500 text-white"; }
  else if (totalScore >= 70) { grade = "B"; gradeColor = "bg-blue-500 text-white"; }
  else if (totalScore >= 55) { grade = "C"; gradeColor = "bg-yellow-500 text-white"; }
  else { grade = "D"; gradeColor = "bg-red-500 text-white"; }

  return (
    <div className="group relative bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg p-3 text-white text-center cursor-help">
      <div className="text-xs font-medium opacity-80 mb-1">Fit Score</div>
      <div className="flex items-center justify-center gap-2">
        <div className={`w-10 h-10 rounded-full ${gradeColor} flex items-center justify-center font-bold text-lg`}>
          {grade}
        </div>
        <div className="text-left">
          <div className="text-lg font-bold">{totalScore}%</div>
          <div className="text-xs opacity-75">{metricDetails.length} metrics</div>
        </div>
      </div>
      {/* Hover Tooltip */}
      <div className="absolute left-0 right-0 top-full mt-2 bg-white text-gray-900 rounded-lg shadow-xl p-3 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
        <div className="text-xs font-semibold mb-2 text-gray-700">Score Breakdown</div>
        <div className="space-y-1">
          {metricDetails.map((m, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{m.label}</span>
              <div className="flex items-center gap-1">
                <span className="font-medium">{m.value}</span>
                <span className={`w-2 h-2 rounded-full ${
                  m.status === "excellent" ? "bg-green-500" :
                  m.status === "good" ? "bg-yellow-500" : "bg-red-500"
                }`} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t text-xs text-gray-500">
          Based on {benchmarks.totalAthletes} historical athletes
        </div>
      </div>
    </div>
  );
}

// Compact Follower Tier for header with hover tooltip
function CompactTierBadge({ followers }: { followers: number | null }) {
  if (!followers) {
    return (
      <div className="bg-gray-100 rounded-lg p-3 text-center">
        <div className="text-xs text-gray-500">Follower Tier</div>
        <div className="text-sm text-gray-400">No data</div>
      </div>
    );
  }

  let tier = "";
  let icon = "";
  let color = "";
  let description = "";
  let range = "";

  if (followers >= 5000000) {
    tier = "Mega Star"; icon = "🏆"; color = "bg-yellow-100 border-yellow-400 text-yellow-800";
    description = "Marquee signing potential"; range = "5M+ followers";
  } else if (followers >= 1000000) {
    tier = "Star"; icon = "⭐"; color = "bg-purple-100 border-purple-400 text-purple-800";
    description = "Major talent"; range = "1M-5M followers";
  } else if (followers >= 500000) {
    tier = "Rising Star"; icon = "🔥"; color = "bg-orange-100 border-orange-400 text-orange-800";
    description = "High potential"; range = "500K-1M followers";
  } else if (followers >= 100000) {
    tier = "Sweet Spot"; icon = "💎"; color = "bg-green-100 border-green-400 text-green-800";
    description = "Ideal OF target range"; range = "100K-500K followers";
  } else if (followers >= 50000) {
    tier = "Growing"; icon = "📈"; color = "bg-blue-100 border-blue-400 text-blue-800";
    description = "Emerging talent"; range = "50K-100K followers";
  } else {
    tier = "Micro"; icon = "🌱"; color = "bg-gray-100 border-gray-400 text-gray-800";
    description = "Niche reach"; range = "Under 50K followers";
  }

  return (
    <div className={`group relative ${color} border-2 rounded-lg p-3 text-center cursor-help`}>
      <div className="text-xs font-medium opacity-70 mb-1">Follower Tier</div>
      <div className="text-lg">{icon}</div>
      <div className="text-sm font-bold">{tier}</div>
      <div className="text-xs opacity-75">{(followers / 1000).toFixed(0)}K</div>
      {/* Hover Tooltip */}
      <div className="absolute left-0 right-0 top-full mt-2 bg-white text-gray-900 rounded-lg shadow-xl p-3 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 border">
        <div className="text-sm font-semibold mb-1">{icon} {tier}</div>
        <div className="text-xs text-gray-600 mb-2">{description}</div>
        <div className="text-xs text-gray-500">{range}</div>
        <div className="mt-2 pt-2 border-t text-xs">
          <span className="font-medium">{followers.toLocaleString()}</span>
          <span className="text-gray-500"> exact followers</span>
        </div>
      </div>
    </div>
  );
}
