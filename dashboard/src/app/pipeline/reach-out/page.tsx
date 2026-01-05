"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  pipeline_stage: string;
}

interface GeneratedMessage {
  athleteId: string;
  message: string;
  generated: boolean;
}

export default function ReachOutStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Map<string, GeneratedMessage>>(new Map());
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=reach_out");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMessage = async (athlete: Athlete) => {
    setGeneratingFor(athlete.id);
    try {
      const response = await fetch("/api/outreach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id }),
      });
      const data = await response.json();

      if (data.message) {
        setMessages((prev) => {
          const next = new Map(prev);
          next.set(athlete.id, {
            athleteId: athlete.id,
            message: data.message,
            generated: true,
          });
          return next;
        });
      }
    } catch (error) {
      console.error("Error generating message:", error);
    } finally {
      setGeneratingFor(null);
    }
  };

  const handleCopyMessage = (athleteId: string) => {
    const msg = messages.get(athleteId);
    if (msg) {
      navigator.clipboard.writeText(msg.message);
    }
  };

  const handleMarkSent = async (athleteId: string) => {
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "response" }),
      });
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
      setMessages((prev) => {
        const next = new Map(prev);
        next.delete(athleteId);
        return next;
      });
    } catch (error) {
      console.error("Error marking sent:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/pipeline" className="text-gray-800 hover:text-gray-800">
            ← Pipeline
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span className="text-3xl">📤</span> Reach Out
            </h1>
            <p className="text-gray-800">Generate and send personalized outreach messages</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-cyan-700">{athletes.length}</div>
          <div className="text-sm text-cyan-600">Ready to Contact</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">{messages.size}</div>
          <div className="text-sm text-gray-800">Messages Generated</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {athletes.length - messages.size}
          </div>
          <div className="text-sm text-gray-800">Pending Generation</div>
        </div>
      </div>

      {/* Workflow Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Outreach Workflow</h3>
        <ol className="text-sm text-blue-700 space-y-1">
          <li>1. Click "Generate Message" to create a personalized DM</li>
          <li>2. Review and edit the message if needed</li>
          <li>3. Click "Copy" to copy the message</li>
          <li>4. Open Instagram and send the DM manually</li>
          <li>5. Click "Mark as Sent" to move to Response stage</li>
        </ol>
      </div>

      {/* Athletes List */}
      {athletes.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">📤</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Prospects Ready for Outreach</h3>
          <p className="text-sm text-gray-800">
            Approve prospects to move them here for outreach.
          </p>
          <Link
            href="/pipeline/approval"
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Approval
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {athletes.map((athlete) => {
            const msg = messages.get(athlete.id);
            return (
              <div key={athlete.id} className="bg-white rounded-lg shadow border p-4">
                <div className="flex items-start gap-4">
                  {/* Profile */}
                  <div className="flex items-center gap-3 w-64">
                    {athlete.profile_pic_url ? (
                      <img
                        src={athlete.profile_pic_url}
                        alt={athlete.name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                        {athlete.name[0]}
                      </div>
                    )}
                    <div>
                      <Link
                        href={`/athletes/${athlete.id}`}
                        className="font-semibold text-gray-900 hover:text-cyan-600"
                      >
                        {athlete.name}
                      </Link>
                      <div className="text-sm text-gray-800">{athlete.sport}</div>
                      {athlete.instagram_handle && (
                        <a
                          href={`https://instagram.com/${athlete.instagram_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          @{athlete.instagram_handle}
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Message Area */}
                  <div className="flex-1">
                    {msg ? (
                      <div className="space-y-2">
                        <textarea
                          value={msg.message}
                          onChange={(e) => {
                            setMessages((prev) => {
                              const next = new Map(prev);
                              next.set(athlete.id, { ...msg, message: e.target.value });
                              return next;
                            });
                          }}
                          rows={4}
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopyMessage(athlete.id)}
                            className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200"
                          >
                            📋 Copy
                          </button>
                          <button
                            onClick={() => handleMarkSent(athlete.id)}
                            className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200"
                          >
                            ✓ Mark as Sent
                          </button>
                          <a
                            href={`https://instagram.com/direct/t/${athlete.instagram_handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded text-sm hover:opacity-90"
                          >
                            Open Instagram DM
                          </a>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleGenerateMessage(athlete)}
                        disabled={generatingFor === athlete.id}
                        className="px-4 py-2 bg-cyan-100 text-cyan-700 rounded-lg hover:bg-cyan-200 disabled:opacity-50"
                      >
                        {generatingFor === athlete.id ? "Generating..." : "✨ Generate Message"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
