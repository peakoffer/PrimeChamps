"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import { AthleteAvatar } from "@/components/AthleteAvatar";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  pipeline_stage: string;
}

interface InstagramPost {
  id: string;
  post_id: string;
  url: string;
  display_url?: string;
  caption?: string;
  likes_count?: number;
  comments_count?: number;
}

interface GeneratedComment {
  id: string;
  dbId?: string; // Database ID from content_engagements
  postId: string;
  postUrl: string;
  postImage?: string;
  postCaption?: string;
  comment: string;
  scheduledFor?: string;
  approved: boolean;
}

interface OutreachPackage {
  athleteId: string;
  athlete: Athlete;
  dmId?: string; // Database ID from outreach_messages
  dmMessage: string;
  dmApproved: boolean;
  comments: GeneratedComment[];
  generating: boolean;
  generated: boolean;
}

export default function ReachOutStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [outreachPackages, setOutreachPackages] = useState<Map<string, OutreachPackage>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedAthlete, setSelectedAthlete] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState("");

  // Fetch athletes in reach_out stage
  const fetchAthletes = useCallback(async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=reach_out");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void fetchAthletes(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchAthletes]);

  // Generate outreach package for an athlete (DM + 3 comments)
  const generateOutreachPackage = async (athlete: Athlete) => {
    // Set generating state
    setOutreachPackages((prev) => {
      const next = new Map(prev);
      next.set(athlete.id, {
        athleteId: athlete.id,
        athlete,
        dmMessage: "",
        dmApproved: false,
        comments: [],
        generating: true,
        generated: false,
      });
      return next;
    });

    try {
      // Generate DM message via API (this saves to database)
      const dmResponse = await fetch("/api/outreach/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id }),
      });
      const dmData = await dmResponse.json();
      const dmId = dmData.message?.id;
      const dmMessage = dmData.message?.content || dmData.message || "";

      // Fetch athlete's photos
      const photosResponse = await fetch(`/api/instagram/photos?athleteId=${athlete.id}`);
      const photosData = await photosResponse.json();
      const photos: InstagramPost[] = photosData.photos || [];

      // Generate comments for up to 3 photos via API
      const comments: GeneratedComment[] = [];
      const photosToComment = photos.slice(0, 3);

      for (const photo of photosToComment) {
        try {
          const commentResponse = await fetch("/api/outreach/generate-comment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              athleteId: athlete.id,
              postId: photo.post_id,
              postUrl: photo.url,
              postCaption: photo.caption,
              postImage: photo.display_url,
            }),
          });
          const commentData = await commentResponse.json();

          comments.push({
            id: `comment-${athlete.id}-${photo.post_id}`,
            dbId: commentData.comment?.id,
            postId: photo.post_id,
            postUrl: photo.url,
            postImage: photo.display_url,
            postCaption: photo.caption?.slice(0, 100),
            comment: commentData.comment?.content || "",
            approved: false,
          });
        } catch (err) {
          console.error("Error generating comment for post:", photo.post_id, err);
        }
      }

      // Update package with generated content
      setOutreachPackages((prev) => {
        const next = new Map(prev);
        next.set(athlete.id, {
          athleteId: athlete.id,
          athlete,
          dmId,
          dmMessage,
          dmApproved: false,
          comments,
          generating: false,
          generated: true,
        });
        return next;
      });
    } catch (error) {
      console.error("Error generating outreach package:", error);
      setOutreachPackages((prev) => {
        const next = new Map(prev);
        const existing = next.get(athlete.id);
        if (existing) {
          next.set(athlete.id, { ...existing, generating: false });
        }
        return next;
      });
    }
  };

  // Regenerate all content for an athlete
  const handleRegenerate = async (athleteId: string) => {
    const pkg = outreachPackages.get(athleteId);
    if (pkg) {
      await generateOutreachPackage(pkg.athlete);
    }
  };

  // Update DM message
  const handleUpdateDm = (athleteId: string, message: string) => {
    setOutreachPackages((prev) => {
      const next = new Map(prev);
      const pkg = next.get(athleteId);
      if (pkg) {
        next.set(athleteId, { ...pkg, dmMessage: message });
      }
      return next;
    });
  };

  // Toggle DM approval
  const handleToggleDmApproval = (athleteId: string) => {
    setOutreachPackages((prev) => {
      const next = new Map(prev);
      const pkg = next.get(athleteId);
      if (pkg) {
        next.set(athleteId, { ...pkg, dmApproved: !pkg.dmApproved });
      }
      return next;
    });
  };

  // Update comment
  const handleUpdateComment = (athleteId: string, commentId: string, newComment: string) => {
    setOutreachPackages((prev) => {
      const next = new Map(prev);
      const pkg = next.get(athleteId);
      if (pkg) {
        const updatedComments = pkg.comments.map((c) =>
          c.id === commentId ? { ...c, comment: newComment } : c
        );
        next.set(athleteId, { ...pkg, comments: updatedComments });
      }
      return next;
    });
  };

  // Toggle comment approval
  const handleToggleCommentApproval = (athleteId: string, commentId: string) => {
    setOutreachPackages((prev) => {
      const next = new Map(prev);
      const pkg = next.get(athleteId);
      if (pkg) {
        const updatedComments = pkg.comments.map((c) =>
          c.id === commentId ? { ...c, approved: !c.approved } : c
        );
        next.set(athleteId, { ...pkg, comments: updatedComments });
      }
      return next;
    });
  };

  // Schedule comment
  const handleScheduleComment = (athleteId: string, commentId: string, scheduledFor: string) => {
    setOutreachPackages((prev) => {
      const next = new Map(prev);
      const pkg = next.get(athleteId);
      if (pkg) {
        const updatedComments = pkg.comments.map((c) =>
          c.id === commentId ? { ...c, scheduledFor } : c
        );
        next.set(athleteId, { ...pkg, comments: updatedComments });
      }
      return next;
    });
  };

  // Save reviewed content as drafts. This page never transmits outreach or
  // advances the athlete as though a message was sent.
  const handleApproveAll = async (athleteId: string) => {
    const pkg = outreachPackages.get(athleteId);
    if (!pkg) return;

    try {
      // Approve DM in database
      if (pkg.dmId && pkg.dmApproved) {
        await fetch("/api/outreach/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: pkg.dmId, type: "dm" }),
        });
      }

      // Approve and schedule comments in database
      for (const comment of pkg.comments) {
        if (comment.dbId && comment.approved) {
          await fetch("/api/outreach/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId: comment.dbId,
              type: "comment",
              scheduledFor: comment.scheduledFor,
            }),
          });
        }
      }

      setSavedNotice("Approved drafts saved. Nothing was sent and the athlete remains in Reach Out.");
    } catch (error) {
      console.error("Error approving outreach:", error);
    }
  };

  // Skip athlete (move back or reject)
  const handleSkip = async (athleteId: string) => {
    try {
      // Move back to approval or mark as skipped
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "approval" }),
      });

      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
      setOutreachPackages((prev) => {
        const next = new Map(prev);
        next.delete(athleteId);
        return next;
      });
    } catch (error) {
      console.error("Error skipping athlete:", error);
    }
  };

  // Copy message to clipboard
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const formatNumber = (num?: number) => {
    if (!num) return "0";
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toString();
  };

  // Stats
  const pendingCount = athletes.length;
  const generatedCount = Array.from(outreachPackages.values()).filter((p) => p.generated).length;
  const readyCount = Array.from(outreachPackages.values()).filter(
    (p) => p.generated && p.dmApproved && p.comments.some((c) => c.approved)
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading outreach queue...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stage Navigation */}
      <PipelineStageNav currentStage="reach_out" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Outreach queue
          </h1>
          <p className="text-gray-600">Review and save generated drafts; sending is always a separate manual action</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAthletes}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Draft-only safety lock:</strong> research and test runs cannot send DMs or comments. Open the provider yourself when you are ready, then record the manual touchpoint separately.
      </div>
      {savedNotice ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{savedNotice}</div> : null}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-blue-700">{pendingCount}</div>
          <div className="text-sm text-blue-600">Pending Review</div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-purple-700">{generatedCount}</div>
          <div className="text-sm text-purple-600">Content Generated</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-700">{readyCount}</div>
          <div className="text-sm text-green-600">Ready to Save</div>
        </div>
      </div>

      {/* Main Content */}
      {athletes.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-12 text-center">
          <div className="text-6xl mb-4">📬</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No athletes in outreach queue</h3>
          <p className="text-gray-600 mb-4">
            Athletes will appear here automatically after approval
          </p>
          <Link
            href="/pipeline/approval"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Approval Queue
          </Link>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Athlete List */}
          <div className="w-80 flex-shrink-0 space-y-2">
            {athletes.map((athlete) => {
              const pkg = outreachPackages.get(athlete.id);
              const isSelected = selectedAthlete === athlete.id;

              return (
                <button
                  key={athlete.id}
                  onClick={() => setSelectedAthlete(athlete.id)}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-white hover:border-blue-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <AthleteAvatar
                      name={athlete.name}
                      profilePicUrl={athlete.profile_pic_url}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{athlete.name}</div>
                      <div className="text-sm text-gray-500 truncate">
                        @{athlete.instagram_handle} · {formatNumber(athlete.follower_count)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {pkg?.generating && (
                        <span className="text-xs text-purple-600 animate-pulse">Generating...</span>
                      )}
                      {pkg?.generated && !pkg.generating && (
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Content Panel */}
          <div className="flex-1 bg-white rounded-lg shadow overflow-hidden">
            {selectedAthlete ? (
              (() => {
                const pkg = outreachPackages.get(selectedAthlete);
                if (!pkg) {
                  const athlete = athletes.find((item) => item.id === selectedAthlete);
                  if (!athlete) return null;
                  return (
                    <div className="grid h-full min-h-[520px] place-items-center p-8 text-center">
                      <div className="max-w-md">
                        <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                        <h2 className="mt-4 text-xl font-semibold text-gray-950">Create drafts for {athlete.name}</h2>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          This intentionally calls the AI and may use API credits. It creates reviewable drafts only—nothing is posted or sent.
                        </p>
                        <button
                          type="button"
                          onClick={() => void generateOutreachPackage(athlete)}
                          className="mt-5 rounded-lg bg-purple-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-800"
                        >
                          Generate draft package
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="h-full flex flex-col">
                    {/* Header */}
                    <div className="p-4 border-b bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <AthleteAvatar
                            name={pkg.athlete.name}
                            profilePicUrl={pkg.athlete.profile_pic_url}
                            size="lg"
                          />
                          <div>
                            <div className="font-semibold text-gray-900">{pkg.athlete.name}</div>
                            <div className="text-sm text-gray-500">
                              @{pkg.athlete.instagram_handle} · {pkg.athlete.sport}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRegenerate(selectedAthlete)}
                            disabled={pkg.generating}
                            className="px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50"
                          >
                            {pkg.generating ? "Generating..." : "Regenerate All"}
                          </button>
                          <a
                            href={`https://instagram.com/${pkg.athlete.instagram_handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                          >
                            View Profile
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                      {/* DM Section */}
                      <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-medium text-gray-900 flex items-center gap-2">
                            <span className="text-lg">📨</span> Direct Message
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCopy(pkg.dmMessage)}
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              Copy
                            </button>
                            <button
                              onClick={() => handleToggleDmApproval(selectedAthlete)}
                              className={`px-2 py-1 text-xs font-medium rounded ${
                                pkg.dmApproved
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {pkg.dmApproved ? "Approved" : "Approve"}
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={pkg.dmMessage}
                          onChange={(e) => handleUpdateDm(selectedAthlete, e.target.value)}
                          className="w-full h-24 p-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Generated message will appear here..."
                        />
                      </div>

                      {/* Comments Section */}
                      <div className="border rounded-lg p-4">
                        <h3 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                          Comments on posts
                          <span className="text-xs text-gray-500 font-normal">
                            ({pkg.comments.filter((c) => c.approved).length}/{pkg.comments.length} approved)
                          </span>
                        </h3>

                        {pkg.comments.length === 0 ? (
                          <p className="text-sm text-gray-500">No photos available for comments</p>
                        ) : (
                          <div className="space-y-4">
                            {pkg.comments.map((comment, index) => (
                              <div key={comment.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                                {/* Post thumbnail */}
                                <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-gray-200">
                                  {comment.postImage ? (
                                    <img
                                      src={comment.postImage}
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                      📷
                                    </div>
                                  )}
                                </div>

                                {/* Comment content */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between mb-2">
                                    <span className="text-xs text-gray-500">Comment #{index + 1}</span>
                                    <button
                                      onClick={() => handleToggleCommentApproval(selectedAthlete, comment.id)}
                                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                                        comment.approved
                                          ? "bg-green-100 text-green-700"
                                          : "bg-gray-200 text-gray-600"
                                      }`}
                                    >
                                      {comment.approved ? "Approved" : "Approve"}
                                    </button>
                                  </div>
                                  <textarea
                                    value={comment.comment}
                                    onChange={(e) =>
                                      handleUpdateComment(selectedAthlete, comment.id, e.target.value)
                                    }
                                    className="w-full h-16 p-2 text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                  />
                                  <div className="flex items-center gap-2 mt-2">
                                    <label className="text-xs text-gray-500">Manual send reminder:</label>
                                    <input
                                      type="datetime-local"
                                      value={comment.scheduledFor || ""}
                                      onChange={(e) =>
                                        handleScheduleComment(selectedAthlete, comment.id, e.target.value)
                                      }
                                      className="text-xs border rounded px-2 py-1"
                                    />
                                    <a
                                      href={comment.postUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 hover:underline ml-auto"
                                    >
                                      View post
                                    </a>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-4 border-t bg-gray-50">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSkip(selectedAthlete)}
                          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                        >
                          Skip
                        </button>
                        <div className="flex-1" />
                        <a
                          href="https://instagram.com/direct/inbox"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90"
                        >
                          Open Instagram
                        </a>
                        <button
                          onClick={() => handleApproveAll(selectedAthlete)}
                          disabled={!pkg.dmApproved}
                          className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Save Approved Drafts
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="h-full flex items-center justify-center p-8">
                <div className="text-center">
                  <div className="text-6xl mb-4">👈</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Select an athlete</h3>
                  <p className="text-gray-600">
                    Choose an athlete from the list to review their outreach content
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
