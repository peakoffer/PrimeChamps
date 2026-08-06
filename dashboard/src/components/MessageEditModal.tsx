"use client";
import { AthleteAvatar } from "@/components/AthleteAvatar";

import { useState } from "react";
import type { OutreachMessage } from "@/lib/supabase/types";

interface MessageEditModalProps {
  message: OutreachMessage;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, content: string) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export default function MessageEditModal({
  message,
  isOpen,
  onClose,
  onSave,
  onApprove,
  onReject,
}: MessageEditModalProps) {
  const [content, setContent] = useState(message.message_content);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const athlete = message.athletes;

  if (!isOpen) return null;

  const hasChanges = content !== message.message_content;

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      await onSave(message.id, content);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      // Save changes first if there are any
      if (hasChanges) {
        await onSave(message.id, content);
      }
      await onApprove(message.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await onReject(message.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setLoading(false);
    }
  };

  // Parse athlete notes for enrichment data
  const parseNotes = (notes: string | null): Record<string, unknown> => {
    if (!notes) return {};
    try {
      return JSON.parse(notes);
    } catch {
      return { bio: notes };
    }
  };

  const athleteNotes = parseNotes(athlete?.notes || null);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex overflow-hidden">
        {/* Left Side - Athlete Profile Sidebar */}
        <div className="w-80 border-r bg-gray-50 overflow-y-auto flex-shrink-0">
          <div className="p-4 border-b bg-white">
            <div className="flex items-center gap-3">
              <AthleteAvatar
                name={athlete?.name || "?"}
                profilePicUrl={athlete?.profile_pic_url}
                size="xl"
              />
              <div>
                <h3 className="font-semibold text-lg">{athlete?.name || "Unknown"}</h3>
                <p className="text-sm text-gray-600">{athlete?.sport || "—"}</p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Social Links */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Social</h4>
              <div className="space-y-1">
                {athlete?.instagram_handle && (
                  <a
                    href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <span className="text-pink-500">@</span>
                    {athlete.instagram_handle}
                  </a>
                )}
                {athlete?.tiktok_handle && (
                  <a
                    href={athlete.tiktok_url || `https://tiktok.com/@${athlete.tiktok_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <span className="text-black">TikTok:</span>
                    @{athlete.tiktok_handle}
                  </a>
                )}
              </div>
            </div>

            {/* Stats */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Stats</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white rounded p-2 border">
                  <div className="text-lg font-bold text-blue-600">
                    {athlete?.follower_count
                      ? (athlete.follower_count / 1000).toFixed(0) + "K"
                      : "—"}
                  </div>
                  <div className="text-xs text-gray-500">Followers</div>
                </div>
                <div className="bg-white rounded p-2 border">
                  <div className="text-lg font-bold text-green-600">
                    {athlete?.engagement_rate
                      ? athlete.engagement_rate.toFixed(1) + "%"
                      : "—"}
                  </div>
                  <div className="text-xs text-gray-500">Engagement</div>
                </div>
              </div>
            </div>

            {/* Bio */}
            {typeof athleteNotes.bio === "string" && athleteNotes.bio && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Bio</h4>
                <p className="text-sm text-gray-700 bg-white rounded p-2 border">
                  {athleteNotes.bio}
                </p>
              </div>
            )}

            {/* Personalization Data Used */}
            {message.personalization_data && Object.keys(message.personalization_data).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                  Personalization Used
                </h4>
                <div className="bg-white rounded p-2 border space-y-1">
                  {Object.entries(message.personalization_data).map(([key, value]) => (
                    <div key={key} className="text-xs">
                      <span className="font-medium text-purple-600">{key}:</span>{" "}
                      <span className="text-gray-700">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Research Score */}
            {typeof athleteNotes.research_score === "number" && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Research Score</h4>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      athleteNotes.research_score >= 80
                        ? "bg-green-100 text-green-700"
                        : athleteNotes.research_score >= 60
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {athleteNotes.research_score}
                  </div>
                  {typeof athleteNotes.research_reasoning === "string" && athleteNotes.research_reasoning && (
                    <p className="text-xs text-gray-600 flex-1">
                      {athleteNotes.research_reasoning.slice(0, 100)}...
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side - Message Editor */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Edit Message</h2>
              <p className="text-sm text-gray-600">
                Review and customize the outreach message
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Editor */}
          <div className="flex-1 p-4 overflow-y-auto">
            {error && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Message Content
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  className="w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Enter your outreach message..."
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-500">
                    {content.length} characters
                  </span>
                  {hasChanges && (
                    <span className="text-xs text-orange-600">
                      Unsaved changes
                    </span>
                  )}
                </div>
              </div>

              {/* Tips */}
              <div className="bg-blue-50 rounded-lg p-3">
                <h4 className="text-sm font-medium text-blue-800 mb-1">Tips</h4>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li>Keep the message personal and authentic</li>
                  <li>Reference specific achievements when possible</li>
                  <li>Keep it under 300 characters for better response rates</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t bg-gray-50 flex justify-between">
            <button
              onClick={handleReject}
              disabled={loading}
              className="px-4 py-2 text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Reject
            </button>
            <div className="flex gap-2">
              {hasChanges && (
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  Save Draft
                </button>
              )}
              <button
                onClick={handleApprove}
                disabled={loading}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? "Processing..." : hasChanges ? "Save & Approve" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
