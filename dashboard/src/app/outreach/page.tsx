"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AthleteAvatar } from "@/components/AthleteAvatar";

// Types
interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  engagement_priority?: string;
  last_touchpoint_at?: string;
  touchpoint_count?: number;
  pipeline_stage: string;
}

interface QueueItem {
  id: string;
  athlete_id: string;
  queue_type: "dm" | "comment";
  content_preview: string;
  approval_status: "pending" | "approved" | "rejected" | "sent";
  auto_approved: boolean;
  created_at: string;
  athlete?: Athlete;
  // For comments
  post_url?: string;
  post_caption_preview?: string;
}

interface Touchpoint {
  id: string;
  touchpoint_type: string;
  channel: string;
  direction?: string;
  content_preview?: string;
  created_at: string;
}

interface InstagramPost {
  id: string;
  post_id: string;
  url: string;
  display_url?: string;
  caption?: string;
  likes_count?: number;
  comments_count?: number;
  timestamp?: string;
}

type TabType = "dms" | "comments" | "sent";
export default function OutreachHubPage() {
  // State
  const [activeTab, setActiveTab] = useState<TabType>("dms");
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [athletePosts, setAthletePosts] = useState<InstagramPost[]>([]);
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([]);
  const [editedContent, setEditedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    pendingDms: 0,
    pendingComments: 0,
    sentToday: 0,
    responseRate: 0,
  });

  // Fetch queue items
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/outreach/queue?type=${activeTab}`);
      const data = await response.json();
      setQueueItems(data.items || []);
      setStats((current) => data.stats || current);
    } catch (error) {
      console.error("Error fetching queue:", error);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  // Fetch athlete details when item selected
  const fetchAthleteDetails = useCallback(async (athleteId: string) => {
    try {
      // Fetch athlete info
      const athleteRes = await fetch(`/api/athletes/${athleteId}`);
      const athleteData = await athleteRes.json();
      setSelectedAthlete(athleteData.athlete);

      // Fetch athlete posts
      const postsRes = await fetch(`/api/instagram/photos?athlete_id=${athleteId}`);
      const postsData = await postsRes.json();
      setAthletePosts(postsData.photos || []);

      // Fetch touchpoints
      const touchpointsRes = await fetch(`/api/outreach/touchpoints?athlete_id=${athleteId}`);
      const touchpointsData = await touchpointsRes.json();
      setTouchpoints(touchpointsData.touchpoints || []);
    } catch (error) {
      console.error("Error fetching athlete details:", error);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void fetchQueue(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchQueue]);

  // Handle item selection
  const handleSelectItem = (item: QueueItem) => {
    setSelectedItem(item);
    setEditedContent(item.content_preview);
    if (item.athlete_id) {
      fetchAthleteDetails(item.athlete_id);
    }
  };

  // Generate message for athlete
  const handleGenerateMessage = async (athleteId: string) => {
    setGenerating(true);
    try {
      const response = await fetch("/api/outreach/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId }),
      });
      const data = await response.json();
      if (data.message) {
        setEditedContent(data.message.content);
        fetchQueue();
      }
    } catch (error) {
      console.error("Error generating message:", error);
    } finally {
      setGenerating(false);
    }
  };

  // Regenerate current message
  const handleRegenerate = async () => {
    if (!selectedItem) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/outreach/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          type: selectedItem.queue_type,
        }),
      });
      const data = await response.json();
      if (data.content) {
        setEditedContent(data.content);
      }
    } catch (error) {
      console.error("Error regenerating:", error);
    } finally {
      setGenerating(false);
    }
  };

  // Approve item
  const handleApprove = async () => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      const response = await fetch("/api/outreach/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          type: selectedItem.queue_type,
          content: editedContent,
        }),
      });
      if (response.ok) {
        // Move to next item
        const currentIndex = queueItems.findIndex((i) => i.id === selectedItem.id);
        const nextItem = queueItems[currentIndex + 1] || queueItems[0];
        if (nextItem && nextItem.id !== selectedItem.id) {
          handleSelectItem(nextItem);
        } else {
          setSelectedItem(null);
        }
        fetchQueue();
      }
    } catch (error) {
      console.error("Error approving:", error);
    } finally {
      setActionLoading(false);
    }
  };

  // Reject item
  const handleReject = async (reason?: string) => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      const response = await fetch("/api/outreach/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          type: selectedItem.queue_type,
          reason,
        }),
      });
      if (response.ok) {
        // Move to next item
        const currentIndex = queueItems.findIndex((i) => i.id === selectedItem.id);
        const nextItem = queueItems[currentIndex + 1] || queueItems[0];
        if (nextItem && nextItem.id !== selectedItem.id) {
          handleSelectItem(nextItem);
        } else {
          setSelectedItem(null);
        }
        fetchQueue();
      }
    } catch (error) {
      console.error("Error rejecting:", error);
    } finally {
      setActionLoading(false);
    }
  };

  // Mark as sent
  const handleMarkSent = async () => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          type: selectedItem.queue_type,
        }),
      });
      if (response.ok) {
        setSelectedItem(null);
        fetchQueue();
      }
    } catch (error) {
      console.error("Error marking sent:", error);
    } finally {
      setActionLoading(false);
    }
  };

  // Copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedContent);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  // Format date helper
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatNumber = (num?: number) => {
    if (!num) return "0";
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toString();
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Draft Outreach Studio</h1>
            <p className="text-sm text-gray-600">
              Prepare evidence-backed messages and comments; every send remains manual
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-semibold text-emerald-800">Draft-only safety lock</span>
            </div>
            <Link
              href="/outreach/settings"
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Settings
            </Link>
            <button
              onClick={fetchQueue}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex gap-4 mt-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            <div className="text-xl font-bold text-blue-700">{stats.pendingDms}</div>
            <div className="text-xs text-blue-600">Pending DMs</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2">
            <div className="text-xl font-bold text-purple-700">{stats.pendingComments}</div>
            <div className="text-xs text-purple-600">Pending Comments</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
            <div className="text-xl font-bold text-green-700">{stats.sentToday}</div>
            <div className="text-xs text-green-600">Manually logged today</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <div className="text-xl font-bold text-amber-700">{stats.responseRate}%</div>
            <div className="text-xs text-amber-600">Response Rate</div>
          </div>
        </div>
      </div>

      {/* Three Panel Layout */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left Panel - Queue */}
        <div className="w-80 flex-shrink-0 bg-white rounded-lg shadow overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab("dms")}
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                activeTab === "dms"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              DMs ({stats.pendingDms})
            </button>
            <button
              onClick={() => setActiveTab("comments")}
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                activeTab === "comments"
                  ? "text-purple-600 border-b-2 border-purple-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Comments ({stats.pendingComments})
            </button>
            <button
              onClick={() => setActiveTab("sent")}
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                activeTab === "sent"
                  ? "text-green-600 border-b-2 border-green-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Sent
            </button>
          </div>

          {/* Queue List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : queueItems.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-2">
                  {activeTab === "dms" ? "📬" : activeTab === "comments" ? "💬" : "✅"}
                </div>
                <div className="text-gray-600">
                  {activeTab === "sent" ? "No sent items yet today" : "Queue is empty"}
                </div>
                {activeTab !== "sent" && (
                  <p className="text-xs text-gray-500 mt-2">
                    Athletes in reach_out stage will appear here
                  </p>
                )}
              </div>
            ) : (
              queueItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectItem(item)}
                  className={`w-full p-3 border-b text-left hover:bg-gray-50 transition-colors ${
                    selectedItem?.id === item.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <AthleteAvatar
                      name={item.athlete?.name || "?"}
                      profilePicUrl={item.athlete?.profile_pic_url}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm truncate">
                        {item.athlete?.name || "Unknown"}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {item.content_preview?.slice(0, 50)}...
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {item.queue_type === "comment" && (
                        <span className="text-purple-500 text-lg">💬</span>
                      )}
                      {item.approval_status === "approved" && (
                        <span className="w-2 h-2 bg-green-500 rounded-full inline-block"></span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Center Panel - Workspace */}
        <div className="flex-1 bg-white rounded-lg shadow overflow-hidden flex flex-col">
          {selectedItem ? (
            <>
              {/* Item Header */}
              <div className="p-4 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AthleteAvatar
                      name={selectedAthlete?.name || "?"}
                      profilePicUrl={selectedAthlete?.profile_pic_url}
                      size="md"
                    />
                    <div>
                      <div className="font-semibold text-gray-900">
                        {selectedAthlete?.name}
                      </div>
                      <div className="text-sm text-gray-500">
                        @{selectedAthlete?.instagram_handle} · {selectedAthlete?.sport}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      selectedItem.queue_type === "dm"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-purple-100 text-purple-700"
                    }`}>
                      {selectedItem.queue_type === "dm" ? "Direct Message" : "Post Comment"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Content Editor */}
              <div className="flex-1 p-4 overflow-y-auto">
                {selectedItem.queue_type === "comment" && selectedItem.post_url && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg border">
                    <div className="text-xs text-gray-500 mb-1">Commenting on post:</div>
                    <div className="text-sm text-gray-700">
                      {selectedItem.post_caption_preview?.slice(0, 100)}...
                    </div>
                    <a
                      href={selectedItem.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                    >
                      View post
                    </a>
                  </div>
                )}

                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {selectedItem.queue_type === "dm" ? "Message" : "Comment"}
                </label>
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full h-40 p-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={selectedItem.queue_type === "dm" ? "Write your message..." : "Write your comment..."}
                />

                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-gray-500">
                    {editedContent.length} characters
                  </span>
                  <button
                    onClick={handleRegenerate}
                    disabled={generating}
                    className="text-sm text-purple-600 hover:text-purple-700 disabled:opacity-50"
                  >
                    {generating ? "Generating..." : "Regenerate"}
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t bg-gray-50">
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Prime Champs will not send this automatically. Approval saves the draft only.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => handleReject()}
                    disabled={actionLoading}
                    className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                  >
                    Skip
                  </button>
                  <div className="flex-1" />
                  {selectedItem.approval_status === "pending" ? (
                    <button
                      onClick={handleApprove}
                      disabled={actionLoading}
                      className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionLoading ? "..." : "Save approved draft"}
                    </button>
                  ) : (
                    <>
                      <a
                        href="https://instagram.com/direct/inbox"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90"
                      >
                        Open Instagram
                      </a>
                      <button
                        onClick={handleMarkSent}
                        disabled={actionLoading}
                        className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {actionLoading ? "..." : "I sent this manually"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">
                  {activeTab === "dms" ? "📨" : "💬"}
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Select an item to review
                </h3>
                <p className="text-sm text-gray-500">
                  Choose a message or comment from the queue to approve
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Athlete Context */}
        <div className="w-80 flex-shrink-0 bg-white rounded-lg shadow overflow-hidden flex flex-col">
          {selectedAthlete ? (
            <>
              {/* Athlete Header */}
              <div className="p-4 border-b">
                <div className="flex items-center gap-3 mb-3">
                  <AthleteAvatar
                    name={selectedAthlete.name}
                    profilePicUrl={selectedAthlete.profile_pic_url}
                    size="lg"
                  />
                  <div>
                    <div className="font-semibold text-gray-900">
                      {selectedAthlete.name}
                    </div>
                    <div className="text-sm text-gray-500">{selectedAthlete.sport}</div>
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <div className="text-lg font-bold text-gray-900">
                      {formatNumber(selectedAthlete.follower_count)}
                    </div>
                    <div className="text-xs text-gray-500">Followers</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900">
                      {selectedAthlete.touchpoint_count || 0}
                    </div>
                    <div className="text-xs text-gray-500">Touchpoints</div>
                  </div>
                </div>
                {selectedAthlete.instagram_handle && (
                  <a
                    href={`https://instagram.com/${selectedAthlete.instagram_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-3 text-center text-sm text-blue-600 hover:underline"
                  >
                    View Instagram Profile
                  </a>
                )}
              </div>

              {/* Recent Posts */}
              <div className="p-4 border-b">
                <h4 className="font-medium text-gray-900 mb-2">Recent Posts</h4>
                {athletePosts.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1">
                    {athletePosts.slice(0, 6).map((post) => (
                      <a
                        key={post.id}
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square bg-gray-100 rounded overflow-hidden hover:opacity-80 transition-opacity"
                      >
                        {post.display_url ? (
                          <img
                            src={post.display_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            📷
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No posts loaded</p>
                )}
                <button
                  onClick={() => handleGenerateMessage(selectedAthlete.id)}
                  disabled={generating}
                  className="w-full mt-2 px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
                >
                  {generating ? "Generating..." : "Generate Comment on Post"}
                </button>
              </div>

              {/* Touchpoint Timeline */}
              <div className="flex-1 p-4 overflow-y-auto">
                <h4 className="font-medium text-gray-900 mb-2">Activity Timeline</h4>
                {touchpoints.length > 0 ? (
                  <div className="space-y-3">
                    {touchpoints.map((tp) => (
                      <div key={tp.id} className="flex gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                          {tp.touchpoint_type === "dm_sent" && "📤"}
                          {tp.touchpoint_type === "dm_received" && "📥"}
                          {tp.touchpoint_type === "comment_sent" && "💬"}
                          {tp.touchpoint_type === "email_sent" && "📧"}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-gray-900">
                            {tp.touchpoint_type.replace(/_/g, " ")}
                          </div>
                          {tp.content_preview && (
                            <div className="text-xs text-gray-500 truncate">
                              {tp.content_preview}
                            </div>
                          )}
                          <div className="text-xs text-gray-400">
                            {formatDate(tp.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No activity yet</p>
                )}
              </div>

              {/* Quick Actions */}
              <div className="p-4 border-t">
                <Link
                  href={`/athletes/${selectedAthlete.id}`}
                  className="block w-full text-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  View Full Profile
                </Link>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center text-gray-500">
                <div className="text-4xl mb-2">👤</div>
                <p className="text-sm">Select an item to see athlete details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
