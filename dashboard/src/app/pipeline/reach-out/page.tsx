"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { cn } from "@/lib/utils";

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
  url: string;
  displayUrl?: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  timestamp?: string | null;
}

interface GeneratedComment {
  id: string;
  dbId?: string; // Database ID from content_engagements
  postId: string;
  postUrl: string;
  postImage?: string;
  postCaption?: string;
  postPublishedAt?: string | null;
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
  generationSource?: "ai" | "template" | "existing";
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
      if (!dmResponse.ok) throw new Error(dmData.error || "Could not generate the direct-message draft");
      const dmId = dmData.message?.id;
      const dmMessage = dmData.message?.content || dmData.message || "";
      const generationSource = dmData.source as OutreachPackage["generationSource"];

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
              postId: photo.id,
              postUrl: photo.url,
              postCaption: photo.caption,
              postImage: photo.displayUrl,
            }),
          });
          const commentData = await commentResponse.json();

          comments.push({
            id: `comment-${athlete.id}-${photo.id}`,
            dbId: commentData.comment?.id,
            postId: photo.id,
            postUrl: photo.url,
            postImage: photo.displayUrl,
            postCaption: photo.caption?.slice(0, 100),
            postPublishedAt: photo.timestamp,
            comment: commentData.comment?.content || "",
            approved: false,
          });
        } catch (err) {
          console.error("Error generating comment for post:", photo.id, err);
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
          generationSource,
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

  if (loading) {
    return <p className="p-6 text-sm text-brand-muted">Loading outreach queue…</p>;
  }

  return (
    <div className="space-y-6">
      <PipelineStageNav currentStage="reach_out" />

      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Reach out</h1>
          <p className="pc-page-description">
            Write and save message drafts for approved athletes. Nothing sends from this page: send from Instagram
            yourself and record the touchpoint separately.
          </p>
        </div>
        <div className="pc-header-actions">
          <button type="button" onClick={fetchAthletes} className="pc-button-secondary">Refresh</button>
        </div>
      </header>

      {savedNotice ? <p role="status" className="text-sm text-emerald-700">{savedNotice}</p> : null}

      {athletes.length === 0 ? (
        <div className="pc-surface p-8 text-center">
          <p className="text-base font-semibold text-brand-ink">No athletes in outreach queue</p>
          <p className="mt-1 text-sm text-brand-muted">Athletes will appear here automatically after approval.</p>
          <Link href="/pipeline/approval" className="pc-button-primary mt-4">
            Go to Approval Queue
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Athlete list */}
          <ul className="pc-surface divide-y divide-brand-ink/10 lg:w-80 lg:self-start lg:flex-shrink-0">
            {athletes.map((athlete) => {
              const pkg = outreachPackages.get(athlete.id);
              const isSelected = selectedAthlete === athlete.id;

              return (
                <li key={athlete.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedAthlete(athlete.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 border-l-2 px-3 py-3 text-left",
                      isSelected ? "border-brand-ink bg-brand-cyan/10" : "border-transparent hover:bg-brand-paper"
                    )}
                  >
                    <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-brand-ink">{athlete.name}</div>
                      <div className="truncate text-xs text-brand-muted">
                        @{athlete.instagram_handle} · {formatNumber(athlete.follower_count)}
                      </div>
                    </div>
                    {pkg?.generating && <span className="text-xs text-brand-blue">Generating…</span>}
                    {pkg?.generated && !pkg.generating && <span className="text-xs text-emerald-700">Drafted</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Draft panel */}
          <div className="pc-surface min-w-0 flex-1 overflow-hidden">
            {selectedAthlete ? (
              (() => {
                const pkg = outreachPackages.get(selectedAthlete);
                if (!pkg) {
                  const athlete = athletes.find((item) => item.id === selectedAthlete);
                  if (!athlete) return null;
                  return (
                    <div className="grid min-h-[420px] place-items-center p-8 text-center">
                      <div className="flex max-w-md flex-col items-center">
                        <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                        <h2 className="mt-4 text-base font-semibold text-brand-ink">Create drafts for {athlete.name}</h2>
                        <p className="mt-1 text-sm text-brand-muted">
                          Creates one personal DM draft plus comment drafts for up to three recent posts. It uses AI credits and sends nothing.
                        </p>
                        <button
                          type="button"
                          onClick={() => void generateOutreachPackage(athlete)}
                          className="pc-button-primary mt-4"
                        >
                          Generate AI drafts
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="flex h-full flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line px-4 py-3">
                      <div className="flex items-center gap-3">
                        <AthleteAvatar name={pkg.athlete.name} profilePicUrl={pkg.athlete.profile_pic_url} size="lg" />
                        <div>
                          <div className="font-semibold text-brand-ink">{pkg.athlete.name}</div>
                          <div className="text-sm text-brand-muted">
                            @{pkg.athlete.instagram_handle} · {pkg.athlete.sport}
                          </div>
                        </div>
                        {pkg.generated ? (
                          <span className="bg-brand-ink/5 px-2 py-0.5 text-[11px] font-semibold text-brand-muted">
                            {pkg.generationSource === "ai" ? "AI draft" : pkg.generationSource === "existing" ? "Saved draft" : "Playbook fallback"}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRegenerate(selectedAthlete)}
                          disabled={pkg.generating}
                          className="pc-button-secondary"
                        >
                          {pkg.generating ? "Generating..." : "Regenerate All"}
                        </button>
                        <a
                          href={`https://instagram.com/${pkg.athlete.instagram_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pc-button-secondary"
                        >
                          View Profile
                        </a>
                      </div>
                    </div>

                    <div className="flex-1 space-y-6 overflow-y-auto p-4">
                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-brand-ink">Direct message draft</h3>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => handleCopy(pkg.dmMessage)}
                              className="text-xs font-medium text-brand-blue hover:underline"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleDmApproval(selectedAthlete)}
                              aria-pressed={pkg.dmApproved}
                              className={cn(
                                "border px-2 py-1 text-xs font-medium",
                                pkg.dmApproved
                                  ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                                  : "border-brand-chrome bg-white text-brand-ink hover:border-brand-ink"
                              )}
                            >
                              {pkg.dmApproved ? "Approved" : "Approve"}
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={pkg.dmMessage}
                          onChange={(e) => handleUpdateDm(selectedAthlete, e.target.value)}
                          className="h-24 w-full border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
                          placeholder="Generated message will appear here..."
                        />
                      </section>

                      <section>
                        <h3 className="mb-2 text-sm font-semibold text-brand-ink">
                          Comments on posts{" "}
                          <span className="text-xs font-normal text-brand-muted">
                            ({pkg.comments.filter((c) => c.approved).length}/{pkg.comments.length} approved)
                          </span>
                        </h3>

                        {pkg.comments.length === 0 ? (
                          <p className="text-sm text-brand-muted">No photos available for comments</p>
                        ) : (
                          <ul className="divide-y divide-brand-ink/10 border-y border-brand-ink/10">
                            {pkg.comments.map((comment, index) => (
                              <li key={comment.id} className="flex gap-3 py-3">
                                <div className="h-20 w-20 flex-shrink-0 overflow-hidden bg-brand-paper">
                                  {comment.postImage ? (
                                    <img src={comment.postImage} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-brand-muted">
                                      No image
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="mb-2 flex items-start justify-between">
                                    <span className="text-xs text-brand-muted">
                                      Comment #{index + 1}
                                      {comment.postPublishedAt ? ` · Posted ${new Date(comment.postPublishedAt).toLocaleDateString()}` : ""}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleCommentApproval(selectedAthlete, comment.id)}
                                      aria-pressed={comment.approved}
                                      className={cn(
                                        "border px-2 py-0.5 text-xs font-medium",
                                        comment.approved
                                          ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                                          : "border-brand-chrome bg-white text-brand-ink hover:border-brand-ink"
                                      )}
                                    >
                                      {comment.approved ? "Approved" : "Approve"}
                                    </button>
                                  </div>
                                  <textarea
                                    value={comment.comment}
                                    onChange={(e) => handleUpdateComment(selectedAthlete, comment.id, e.target.value)}
                                    className="h-16 w-full border border-brand-chrome bg-white px-2 py-1.5 text-sm text-brand-ink"
                                  />
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <label className="text-xs text-brand-muted">Manual send reminder:</label>
                                    <input
                                      type="datetime-local"
                                      value={comment.scheduledFor || ""}
                                      onChange={(e) => handleScheduleComment(selectedAthlete, comment.id, e.target.value)}
                                      className="border border-brand-chrome bg-white px-2 py-1 text-xs text-brand-ink"
                                    />
                                    <a
                                      href={comment.postUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-auto text-xs text-brand-blue hover:underline"
                                    >
                                      View post
                                    </a>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-brand-line px-4 py-3">
                      <button type="button" onClick={() => handleSkip(selectedAthlete)} className="pc-button-secondary">
                        Skip
                      </button>
                      <div className="flex-1" />
                      <a
                        href="https://instagram.com/direct/inbox"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pc-button-secondary"
                      >
                        Open Instagram
                      </a>
                      <button
                        type="button"
                        onClick={() => handleApproveAll(selectedAthlete)}
                        disabled={!pkg.dmApproved}
                        className="pc-button-primary"
                      >
                        Save Approved Drafts
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="grid min-h-[420px] place-items-center p-8 text-center">
                <div>
                  <p className="text-base font-semibold text-brand-ink">Select an athlete</p>
                  <p className="mt-1 text-sm text-brand-muted">
                    Choose an athlete from the list to review their outreach content.
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
