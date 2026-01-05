"use client";

import { useEffect, useState, useCallback } from "react";
import { formatDate } from "@/lib/utils";

interface AgentRun {
  id: string;
  agent_type: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  records_processed: number;
  records_success: number;
  records_failed: number;
  errors?: unknown[];
}

interface Agent {
  id: string;
  name: string;
  description: string;
  icon: string;
  lastRun: AgentRun | null;
  stats: {
    totalRuns: number;
    successfulRuns: number;
    successRate: number;
    totalRecords: number;
  };
}

interface ProgressInfo {
  current: number;
  total: number;
  percent: number;
  message: string;
}

interface RunResult {
  success: boolean;
  message: string;
  job_id?: string;
  result?: {
    processed?: number;
    success?: number;
    failed?: number;
    scored?: number;
    generated?: number;
    discovered?: number;
    added?: number;
  };
  error?: string;
  serverRequired?: boolean;
  instructions?: string;
}

interface JobProgress {
  status: string;
  progress?: ProgressInfo;
  result?: RunResult["result"];
  error?: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  const [lastResults, setLastResults] = useState<Record<string, RunResult>>({});
  const [agentProgress, setAgentProgress] = useState<Record<string, JobProgress>>({});

  const checkServerHealth = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:8000/health", {
        method: "GET",
      });
      setServerOnline(response.ok);
    } catch {
      setServerOnline(false);
    }
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await fetch("/api/agents");
      const data = await response.json();

      if (data.migrationNeeded) {
        setMigrationNeeded(true);
        setAgents(data.agents || []);
      } else {
        setAgents(data.agents || []);
      }
    } catch (error) {
      console.error("Error fetching agents:", error);
    } finally {
      setLoading(false);
    }
  };

  const runAgent = async (agentId: string) => {
    setRunningAgents((prev) => new Set(prev).add(agentId));
    setLastResults((prev) => ({ ...prev, [agentId]: undefined as unknown as RunResult }));
    setAgentProgress((prev) => ({ ...prev, [agentId]: { status: "starting" } }));

    try {
      // Start async job
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, sync: false }),
      });

      const data: RunResult = await response.json();

      if (!data.job_id) {
        // Sync response (no job_id) - completed immediately
        setLastResults((prev) => ({ ...prev, [agentId]: data }));
        setAgentProgress((prev) => ({ ...prev, [agentId]: { status: "completed" } }));
        await fetchAgents();
        return;
      }

      // Poll for job progress
      const jobId = data.job_id;
      const pollInterval = setInterval(async () => {
        try {
          const jobResponse = await fetch(`/api/agents/jobs/${jobId}`);
          const jobData: JobProgress = await jobResponse.json();

          setAgentProgress((prev) => ({ ...prev, [agentId]: jobData }));

          if (jobData.status === "completed" || jobData.status === "failed") {
            clearInterval(pollInterval);

            setLastResults((prev) => ({
              ...prev,
              [agentId]: {
                success: jobData.status === "completed",
                message: jobData.status === "completed" ? "Completed successfully" : "Failed",
                result: jobData.result,
                error: jobData.error,
              },
            }));

            setRunningAgents((prev) => {
              const next = new Set(prev);
              next.delete(agentId);
              return next;
            });

            await fetchAgents();
          }
        } catch (pollError) {
          console.error("Error polling job:", pollError);
        }
      }, 500);

      // Safety timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setRunningAgents((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      }, 300000);

    } catch (error) {
      setLastResults((prev) => ({
        ...prev,
        [agentId]: {
          success: false,
          message: "Failed to run agent",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      }));
      setAgentProgress((prev) => ({ ...prev, [agentId]: { status: "failed" } }));
      setRunningAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchAgents();
    checkServerHealth();

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchAgents();
      checkServerHealth();
    }, 30000);

    return () => clearInterval(interval);
  }, [checkServerHealth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading agents...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Agent Control Panel</h1>
        <div className="flex items-center gap-4">
          {/* Server Status */}
          <div className="flex items-center gap-2 text-sm">
            <div
              className={`w-2 h-2 rounded-full ${
                serverOnline === null
                  ? "bg-gray-400"
                  : serverOnline
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            />
            <span className="text-gray-800">
              {serverOnline === null
                ? "Checking..."
                : serverOnline
                ? "Server Online"
                : "Server Offline"}
            </span>
          </div>
          <button
            onClick={() => {
              fetchAgents();
              checkServerHealth();
            }}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Server Offline Warning */}
      {serverOnline === false && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <span className="text-2xl mr-3">!</span>
            <div>
              <h3 className="font-semibold text-red-800">Agent Server Not Running</h3>
              <p className="text-sm text-red-700 mt-1">
                Start the agent server to enable Run buttons:
              </p>
              <code className="block bg-red-100 px-3 py-2 rounded mt-2 text-sm font-mono text-red-900">
                cd backend && python -m uvicorn backend.server:app --reload
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Migration Warning */}
      {migrationNeeded && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <span className="text-2xl mr-3">!</span>
            <div>
              <h3 className="font-semibold text-yellow-800">Database Migration Required</h3>
              <p className="text-sm text-yellow-700 mt-1">
                Run <code className="bg-yellow-100 px-1 rounded">migration_v2_agents.sql</code> in
                Supabase SQL Editor to enable agent tracking.
              </p>
              <p className="text-xs text-yellow-600 mt-2">
                File location: <code>/scripts/migration_v2_agents.sql</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Overview */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Flow</h2>
        <div className="flex items-center justify-between">
          {agents.map((agent, index) => (
            <div key={agent.id} className="flex items-center">
              <div className="text-center">
                <div className="text-3xl mb-2">{agent.icon}</div>
                <div className="text-sm font-medium">{agent.name.replace(" Agent", "")}</div>
              </div>
              {index < agents.length - 1 && (
                <div className="mx-4 text-gray-500 text-2xl">-{">"}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isRunning={runningAgents.has(agent.id)}
            lastResult={lastResults[agent.id]}
            progress={agentProgress[agent.id]}
            serverOnline={serverOnline === true}
            onRun={() => runAgent(agent.id)}
          />
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={async () => {
              // Run full pipeline: enrichment -> scoring -> outreach
              for (const agentId of ["enrichment", "scoring", "outreach"]) {
                await runAgent(agentId);
              }
            }}
            disabled={!serverOnline || runningAgents.size > 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Full Pipeline
          </button>
          <button
            onClick={() => runAgent("enrichment")}
            disabled={!serverOnline || runningAgents.has("enrichment")}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Quick Enrich
          </button>
          <button
            onClick={() => runAgent("scoring")}
            disabled={!serverOnline || runningAgents.has("scoring")}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Rescore All
          </button>
        </div>
      </div>

      {/* Logs Section */}
      <LogsPanel />

      {/* Help Section */}
      <details className="bg-gray-50 rounded-lg">
        <summary className="p-4 cursor-pointer font-semibold text-gray-800 hover:text-gray-900">
          CLI Commands Reference (Advanced)
        </summary>
        <div className="px-4 pb-4 space-y-2 font-mono text-sm">
          <div className="bg-white p-3 rounded border">
            <span className="text-gray-800"># Start the agent server</span>
            <br />
            python -m uvicorn backend.server:app --reload
          </div>
          <div className="bg-white p-3 rounded border">
            <span className="text-gray-800"># Enrich all pending athletes</span>
            <br />
            python -m backend.cli enrich --all
          </div>
          <div className="bg-white p-3 rounded border">
            <span className="text-gray-800"># Score all enriched athletes</span>
            <br />
            python -m backend.cli score --all
          </div>
          <div className="bg-white p-3 rounded border">
            <span className="text-gray-800"># Generate outreach messages</span>
            <br />
            python -m backend.cli outreach --generate
          </div>
        </div>
      </details>
    </div>
  );
}

interface LogEntry {
  id: string;
  log_level: string;
  component: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") {
        params.set("component", filter);
      }
      const response = await fetch(`/api/logs?${params}`);
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchLogs();
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [fetchLogs, autoRefresh]);

  const levelColors: Record<string, string> = {
    info: "text-blue-600 bg-blue-50",
    warning: "text-yellow-600 bg-yellow-50",
    error: "text-red-600 bg-red-50",
    debug: "text-gray-600 bg-gray-50",
  };

  const componentFilters = ["all", "enrichment_agent", "scoring_agent", "research_agent", "outreach_agent"];

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="p-4 border-b flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Agent Logs</h2>
        <div className="flex items-center gap-4">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          >
            {componentFilters.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All Agents" : f.replace("_agent", "").replace("_", " ")}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchLogs}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-800">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-4 text-center text-gray-800">
            No logs yet. Run an agent to see activity here.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-800">Time</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-800">Level</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-800">Agent</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-800">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        levelColors[log.log_level] || "text-gray-600 bg-gray-50"
                      }`}
                    >
                      {log.log_level}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-800">
                    {log.component.replace("_agent", "")}
                  </td>
                  <td className="px-4 py-2 text-gray-900 max-w-md truncate" title={log.message}>
                    {log.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  isRunning,
  lastResult,
  progress,
  serverOnline,
  onRun,
}: {
  agent: Agent;
  isRunning: boolean;
  lastResult?: RunResult;
  progress?: JobProgress;
  serverOnline: boolean;
  onRun: () => void;
}) {
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    running: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };

  const lastRunStatus = agent.lastRun?.status || "never";

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-3xl">{agent.icon}</div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{agent.name}</h3>
            <p className="text-sm text-gray-800">{agent.description}</p>
          </div>
        </div>
        {lastRunStatus !== "never" && (
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              statusColors[lastRunStatus] || "bg-gray-100 text-gray-800"
            }`}
          >
            {lastRunStatus}
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-gray-900">{agent.stats.totalRuns}</div>
          <div className="text-xs text-gray-800">Total Runs</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{agent.stats.successRate}%</div>
          <div className="text-xs text-gray-800">Success Rate</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{agent.stats.totalRecords}</div>
          <div className="text-xs text-gray-800">Records</div>
        </div>
      </div>

      {/* Last Run Info */}
      {agent.lastRun && (
        <div className="mt-4 pt-4 border-t text-sm text-gray-800">
          <div className="flex justify-between">
            <span>Last run:</span>
            <span>{formatDate(agent.lastRun.started_at)}</span>
          </div>
          {agent.lastRun.records_processed > 0 && (
            <div className="flex justify-between mt-1">
              <span>Processed:</span>
              <span>
                {agent.lastRun.records_success}/{agent.lastRun.records_processed} success
              </span>
            </div>
          )}
        </div>
      )}

      {/* Last Result */}
      {lastResult && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm ${
            lastResult.success
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {lastResult.success ? (
            <div>
              <div className="font-medium">Completed successfully</div>
              {lastResult.result && (
                <div className="mt-1 text-xs">
                  {lastResult.result.processed !== undefined && (
                    <span>Processed: {lastResult.result.processed} | </span>
                  )}
                  {lastResult.result.scored !== undefined && (
                    <span>Scored: {lastResult.result.scored} | </span>
                  )}
                  {lastResult.result.generated !== undefined && (
                    <span>Generated: {lastResult.result.generated} | </span>
                  )}
                  {lastResult.result.success !== undefined && (
                    <span>Success: {lastResult.result.success}</span>
                  )}
                  {lastResult.result.failed !== undefined && lastResult.result.failed > 0 && (
                    <span> | Failed: {lastResult.result.failed}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="font-medium">Error</div>
              <div className="mt-1 text-xs">{lastResult.error || lastResult.message}</div>
              {lastResult.serverRequired && (
                <div className="mt-2">
                  <code className="text-xs bg-red-100 px-2 py-1 rounded">
                    {lastResult.instructions}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Run Button / Progress Bar */}
      <div className="mt-4 pt-4 border-t">
        {isRunning && progress?.progress ? (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-blue-700 font-medium">
                {progress.progress.percent}% Complete
              </span>
              <span className="text-gray-800">
                {progress.progress.current}/{progress.progress.total}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress.progress.percent}%` }}
              />
            </div>
            {progress.progress.message && (
              <div className="text-xs text-gray-800 truncate" title={progress.progress.message}>
                {progress.progress.message}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onRun}
            disabled={!serverOnline || isRunning}
            className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
              isRunning
                ? "bg-blue-100 text-blue-700 cursor-wait"
                : serverOnline
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-600 cursor-not-allowed"
            }`}
          >
            {isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Starting...
              </span>
            ) : serverOnline ? (
              "Run Agent"
            ) : (
              "Server Offline"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
