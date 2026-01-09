"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, type Athlete } from "@/lib/supabase";
import { formatNumber, formatDate, getStatusColor } from "@/lib/utils";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import AppointmentModal from "@/components/AppointmentModal";
import ContractModal from "@/components/ContractModal";
import { ComposeBox, OutcomeModal } from "@/components/conversations";
import type { BenchmarkMetrics } from "@/app/api/benchmarks/route";

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

const PIPELINE_STAGES = {
  research: { label: "Research", color: "bg-purple-100 text-purple-800 border-purple-300", icon: "🔍" },
  approval: { label: "Pending Approval", color: "bg-blue-100 text-blue-800 border-blue-300", icon: "✅" },
  reach_out: { label: "Ready for Outreach", color: "bg-cyan-100 text-cyan-800 border-cyan-300", icon: "📤" },
  response: { label: "Awaiting Response", color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: "💬" },
  appointment: { label: "Appointment Set", color: "bg-orange-100 text-orange-800 border-orange-300", icon: "📅" },
  contract: { label: "Contract Signed", color: "bg-green-100 text-green-800 border-green-300", icon: "🎉" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-300", icon: "❌" },
};

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
  const [enriching, setEnriching] = useState(false);
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
  }>>([]);
  const [athleteContracts, setAthleteContracts] = useState<Array<{
    id: string;
    status: string;
    contract_type: string;
    revenue_share_percent?: number;
    signed_at?: string;
  }>>([]);

  // Instagram photos state
  const [instagramPhotos, setInstagramPhotos] = useState<Array<{
    id: string;
    url: string;
    displayUrl: string;
    caption?: string;
    likesCount?: number;
    commentsCount?: number;
  }>>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);

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
            setInstagramPhotos(data.photos);
          }
        })
        .catch(err => console.error("Error loading photos:", err));
    }
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
          setInstagramPhotos(dbData.photos);
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
        setInstagramPhotos(data.photos);
        setPhotosError(null);

        // Show success message with stats
        if (data.stats) {
          const msg = data.stats.new > 0
            ? `Loaded ${data.stats.new} new photo${data.stats.new > 1 ? "s" : ""} (${data.stats.total} total)`
            : `All ${data.stats.total} photos already loaded`;
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

  const handleEnrichFromSource = async (source: string) => {
    if (!athlete) return;

    if (source === "instagram" && !athlete.instagram_handle) {
      setMessage({ type: "error", text: "No Instagram handle to enrich" });
      return;
    }

    setEnriching(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/athletes/${athlete.id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.success) {
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

        const dataInfo = result.data;
        if (source === "instagram" && dataInfo?.followers) {
          setMessage({ type: "success", text: `Enriched from Instagram! ${dataInfo.followers.toLocaleString()} followers` });
        } else if (dataInfo?.message) {
          setMessage({ type: "success", text: dataInfo.message });
        } else {
          setMessage({ type: "success", text: `Enriched from ${source}!` });
        }
      } else {
        throw new Error(result.error || "Enrichment failed");
      }
    } catch (error) {
      console.error(`Error enriching from ${source}:`, error);
      setMessage({ type: "error", text: `Failed to enrich from ${source}. Make sure agent server is running.` });
    } finally {
      setEnriching(false);
    }
  };

  // Backward compatibility
  const handleReEnrich = () => handleEnrichFromSource("instagram");

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
        <a href="/athletes" className="text-blue-600 hover:underline mt-4 inline-block">
          ← Back to athletes
        </a>
      </div>
    );
  }

  const ig = parsedData?.instagram || {};
  const contract = parsedData?.contract || {};

  // Calculate engagement rate if we have the data
  const engagementRate = instagramPhotos.length > 0 && athlete.follower_count
    ? (instagramPhotos.reduce((sum, p) => sum + (p.likesCount || 0) + (p.commentsCount || 0), 0) / instagramPhotos.length / athlete.follower_count * 100).toFixed(2)
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
          <div className="flex-1">
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

            {/* Stats Row - Instagram Style */}
            <div className="flex gap-8 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-gray-900">{formatNumber(athlete.follower_count)}</div>
                <div className="text-sm text-gray-700 font-medium">Followers</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-gray-900">{formatNumber(ig.following) || "—"}</div>
                <div className="text-sm text-gray-700 font-medium">Following</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-gray-900">{formatNumber(ig.posts) || "—"}</div>
                <div className="text-sm text-gray-700 font-medium">Posts</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-gray-900">
                  {ig.follower_following_ratio
                    ? `${ig.follower_following_ratio}x`
                    : ig.following && athlete.follower_count
                    ? `${(athlete.follower_count / ig.following).toFixed(1)}x`
                    : "—"}
                </div>
                <div className="text-sm text-gray-700 font-medium">Ratio</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-gray-900">
                  {ig.engagement_rate
                    ? `${ig.engagement_rate}%`
                    : engagementRate
                    ? `${engagementRate}%`
                    : "—"}
                </div>
                <div className="text-sm text-gray-700 font-medium">Engagement</div>
              </div>
              {ig.avg_likes && (
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900">{formatNumber(ig.avg_likes)}</div>
                  <div className="text-sm text-gray-700 font-medium">Avg Likes</div>
                </div>
              )}
            </div>

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
        </div>
      </div>

      {/* Pipeline Status Bar */}
      {athlete.pipeline_stage && (
        <div className="bg-white shadow rounded-lg p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-900 font-medium">Pipeline Status:</span>
              <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                PIPELINE_STAGES[athlete.pipeline_stage as keyof typeof PIPELINE_STAGES]?.color || "bg-gray-100 text-gray-800"
              }`}>
                {PIPELINE_STAGES[athlete.pipeline_stage as keyof typeof PIPELINE_STAGES]?.icon}{" "}
                {PIPELINE_STAGES[athlete.pipeline_stage as keyof typeof PIPELINE_STAGES]?.label || athlete.pipeline_stage}
              </span>
            </div>

            {/* Stage Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {athlete.pipeline_stage === "approval" && (
                <>
                  <button
                    onClick={() => setShowApprovalModal(true)}
                    className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium"
                  >
                    Approve →
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
                  {movingStage ? "..." : "Mark as Contacted →"}
                </button>
              )}
              {athlete.pipeline_stage === "response" && (
                <>
                  <button
                    onClick={() => handleMoveStage("appointment")}
                    disabled={movingStage}
                    className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50 font-medium"
                  >
                    {movingStage ? "..." : "Schedule Appointment →"}
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
                    onClick={() => handleMoveStage("contract")}
                    disabled={movingStage}
                    className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                  >
                    {movingStage ? "..." : "Contract Signed! 🎉"}
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
          </div>
        </div>
      )}

      {/* Tab Selector */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("info")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "info"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300"
            }`}
          >
            Profile Info
          </button>
          <button
            onClick={() => setActiveTab("conversation")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "conversation"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300"
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info Card */}
        <div className="lg:col-span-2 space-y-6">
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

          {/* Data Sections by Source */}

          {/* Instagram Data Section */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                📸 Instagram Data
                {ig.scraped_at && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded">
                    Updated {new Date(ig.scraped_at).toLocaleDateString()}
                  </span>
                )}
              </h2>
              <button
                onClick={() => handleEnrichFromSource("instagram")}
                disabled={enriching || !athlete.instagram_handle}
                className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
              >
                {enriching ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Main Metrics Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <DataCard label="Followers" value={formatNumber(athlete.follower_count)} />
                <DataCard label="Following" value={formatNumber(ig.following)} />
                <DataCard label="Posts" value={formatNumber(ig.posts)} />
                <DataCard
                  label="Ratio"
                  value={ig.follower_following_ratio ? `${ig.follower_following_ratio}x` : (ig.following && athlete.follower_count ? `${(athlete.follower_count / ig.following).toFixed(1)}x` : "—")}
                />
                <DataCard
                  label="Engagement"
                  value={ig.engagement_rate ? `${ig.engagement_rate}%` : "—"}
                />
              </div>

              {/* Secondary Metrics Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DataCard label="Avg Likes" value={ig.avg_likes ? formatNumber(ig.avg_likes) : "—"} />
                <DataCard label="Avg Comments" value={ig.avg_comments ? formatNumber(ig.avg_comments) : "—"} />
                <DataCard label="Highlights" value={ig.highlights ? formatNumber(ig.highlights) : "—"} />
                <DataCard label="IGTV/Reels" value={ig.igtv_videos ? formatNumber(ig.igtv_videos) : "—"} />
              </div>

              {/* Account Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-700 font-medium">Account Type:</span>
                  <span className="ml-2 font-bold text-gray-900">{ig.business ? "Business" : "Personal"}</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-700 font-medium">Private:</span>
                  <span className="ml-2 font-bold text-gray-900">{ig.private ? "Yes" : "No"}</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-700 font-medium">Verified:</span>
                  <span className="ml-2 font-bold text-gray-900">{ig.verified ? "✓ Yes" : "No"}</span>
                </div>
                {ig.business_category && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-gray-700 font-medium">Category:</span>
                    <span className="ml-2 font-bold text-gray-900">{ig.business_category}</span>
                  </div>
                )}
              </div>

              {/* External Link (Link in Bio) */}
              {ig.external_url && (
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <span className="text-blue-800 font-medium">Link in Bio:</span>
                  <a
                    href={ig.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-blue-600 hover:underline font-medium break-all"
                  >
                    {ig.external_url}
                  </a>
                  {ig.external_url.toLowerCase().includes("onlyfans") && (
                    <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded font-medium">
                      ⚠️ OnlyFans Link!
                    </span>
                  )}
                  {(ig.external_url.toLowerCase().includes("linktree") || ig.external_url.toLowerCase().includes("linktr.ee")) && (
                    <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
                      Linktree
                    </span>
                  )}
                </div>
              )}

              {/* Additional Info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                {ig.full_name && ig.full_name !== athlete.name && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-gray-700 font-medium">Display Name:</span>
                    <span className="ml-2 font-bold text-gray-900">{ig.full_name}</span>
                  </div>
                )}
                {ig.username && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <span className="text-gray-700 font-medium">Username:</span>
                    <span className="ml-2 font-bold text-gray-900">@{ig.username}</span>
                  </div>
                )}
                {ig.joined_recently && (
                  <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                    <span className="text-yellow-800 font-medium">⚠️ New Account</span>
                  </div>
                )}
                {ig.has_channel && (
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                    <span className="text-purple-800 font-medium">📢 Has Broadcast Channel</span>
                  </div>
                )}
              </div>

              {/* Related Profiles */}
              {ig.related_profiles && ig.related_profiles.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Related Profiles ({ig.related_profiles.length})</h3>
                  <div className="flex flex-wrap gap-2">
                    {ig.related_profiles.slice(0, 8).map((rp, idx) => (
                      <a
                        key={idx}
                        href={`https://instagram.com/${rp.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-900 font-medium"
                      >
                        @{rp.username}
                        {rp.verified && " ✓"}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Latest Posts Summary */}
              {ig.latest_posts && ig.latest_posts.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Latest Posts Engagement ({ig.latest_posts.length} posts)</h3>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {ig.latest_posts.slice(0, 6).map((post, idx) => (
                      <a
                        key={idx}
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gray-50 hover:bg-gray-100 rounded-lg p-2 text-center"
                      >
                        <div className="text-sm font-bold text-gray-900">{formatNumber(post.likes)}</div>
                        <div className="text-xs text-gray-700">❤️ likes</div>
                        <div className="text-xs text-gray-700 mt-1">{formatNumber(post.comments)} 💬</div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Instagram Photos Gallery */}
          {athlete.instagram_handle && (
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">📷 Instagram Photos</h2>
                <div className="flex gap-2">
                  {instagramPhotos.length > 0 && (
                    <button
                      onClick={() => fetchInstagramPhotos(true)}
                      disabled={photosLoading}
                      className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      title="Fetch new photos from Instagram"
                    >
                      {photosLoading ? "Fetching..." : "Get New Pics"}
                    </button>
                  )}
                  <button
                    onClick={() => fetchInstagramPhotos(instagramPhotos.length === 0)}
                    disabled={photosLoading}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {photosLoading ? "Loading..." : instagramPhotos.length > 0 ? "Show Loaded" : "Load Photos"}
                  </button>
                </div>
              </div>

              {photosError && (
                <div className={`text-sm mb-4 ${photosError.includes("Fetching") ? "text-blue-600" : "text-red-600"}`}>
                  {photosError.includes("Fetching") && (
                    <span className="inline-block animate-spin mr-2">⏳</span>
                  )}
                  {photosError}
                </div>
              )}

              {photosLoading ? (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="aspect-square bg-gray-200 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : instagramPhotos.length > 0 ? (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
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
                      {/* Hover overlay with stats */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="text-white text-center text-sm">
                          {photo.likesCount && (
                            <div>❤️ {photo.likesCount.toLocaleString()}</div>
                          )}
                          {photo.commentsCount && (
                            <div>💬 {photo.commentsCount.toLocaleString()}</div>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>Click "Load Photos" to view @{athlete.instagram_handle}'s recent posts</p>
                  <p className="text-xs mt-1">This helps you quickly review their content before making a decision</p>
                </div>
              )}
            </div>
          )}

          {/* Google/Wikipedia Data Section */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-gray-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                🔍 Google / Wikipedia Data
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEnrichFromSource("google")}
                  disabled={enriching}
                  className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
                >
                  Google
                </button>
                <button
                  onClick={() => handleEnrichFromSource("wikipedia")}
                  disabled={enriching}
                  className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
                >
                  Wikipedia
                </button>
              </div>
            </div>
            <div className="p-6">
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
                disabled={enriching}
                className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
              >
                {enriching ? "Searching..." : "Search TikTok"}
              </button>
            </div>
            <div className="p-6 text-center text-gray-700">
              Click "Search TikTok" to find this athlete's TikTok profile and data.
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
                disabled={enriching}
                className="px-3 py-1.5 bg-white/20 text-white text-sm rounded-lg hover:bg-white/30 disabled:opacity-50 font-medium"
              >
                {enriching ? "Checking..." : "Check OnlyFans"}
              </button>
            </div>
            <div className="p-6">
              {(contract.of_username || contract.of_url || contract.division) ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
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
                  Click "Check OnlyFans" to see if this athlete has an OnlyFans presence.
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
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Fit Score */}
          {benchmarks && (
            <FitScoreCard
              athlete={athlete}
              instagramData={ig}
              benchmarks={benchmarks}
            />
          )}

          {/* Follower Tier */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Follower Tier</h2>
            <TierBadge followers={athlete.follower_count} />
          </div>

          {/* Quick Actions */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <button
                onClick={handleResetEnrichment}
                className="w-full bg-yellow-100 text-yellow-800 px-4 py-2 rounded-lg hover:bg-yellow-200 font-medium"
              >
                Reset to Pending
              </button>
              <button
                onClick={handleDelete}
                className="w-full bg-red-100 text-red-700 px-4 py-2 rounded-lg hover:bg-red-200 font-medium"
              >
                Delete Athlete
              </button>
            </div>
          </div>

          {/* Appointments & Contracts */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Appointments & Contracts</h2>

            {/* Appointment Actions */}
            <div className="mb-4">
              <button
                onClick={() => setShowAppointmentModal(true)}
                className="w-full bg-orange-100 text-orange-700 px-4 py-2 rounded-lg hover:bg-orange-200 font-medium"
              >
                📅 Schedule Appointment
              </button>
            </div>

            {/* Appointments List */}
            {athleteAppointments.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-800 mb-2">Appointments</h3>
                <div className="space-y-2">
                  {athleteAppointments.slice(0, 3).map((appt) => (
                    <div key={appt.id} className="text-sm p-2 bg-gray-50 rounded">
                      <div className="flex justify-between">
                        <span>{new Date(appt.scheduled_at).toLocaleDateString()}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          appt.status === "completed" ? "bg-green-100 text-green-700" :
                          appt.status === "scheduled" ? "bg-blue-100 text-blue-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {appt.status}
                        </span>
                      </div>
                      {appt.outcome && (
                        <div className="text-xs text-gray-600 mt-1">
                          Outcome: {appt.outcome.replace("_", " ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contract Actions */}
            <div className="mb-4">
              <button
                onClick={() => setShowContractModal(true)}
                className="w-full bg-green-100 text-green-700 px-4 py-2 rounded-lg hover:bg-green-200 font-medium"
              >
                📝 Create Contract
              </button>
            </div>

            {/* Contracts List */}
            {athleteContracts.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-800 mb-2">Contracts</h3>
                <div className="space-y-2">
                  {athleteContracts.map((contract) => (
                    <div key={contract.id} className="text-sm p-2 bg-gray-50 rounded">
                      <div className="flex justify-between">
                        <span className="capitalize">{contract.contract_type}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          contract.status === "signed" ? "bg-green-100 text-green-700" :
                          contract.status === "draft" ? "bg-gray-100 text-gray-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {contract.status}
                        </span>
                      </div>
                      {contract.revenue_share_percent && (
                        <div className="text-xs text-gray-600 mt-1">
                          {contract.revenue_share_percent}% revenue share
                        </div>
                      )}
                      {contract.signed_at && (
                        <div className="text-xs text-green-600 mt-1">
                          Signed: {new Date(contract.signed_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes / Raw Data */}
      {parsedData?.other && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Notes</h2>
          <p className="text-gray-800">{parsedData.other}</p>
        </div>
      )}
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
