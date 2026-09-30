"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: { row: number; error: string }[];
  imported_names?: string[];
  skipped_names?: string[];
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: ImportResult) => void;
}

const STAGES = [
  { id: "research", name: "Research" },
  { id: "approval", name: "Approval" },
  { id: "reach_out", name: "Reach Out" },
  { id: "response", name: "Response" },
  { id: "appointment", name: "Appointment" },
  { id: "contract", name: "Contract" },
];

export default function ImportModal({ isOpen, onClose, onComplete }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [defaultStage, setDefaultStage] = useState("research");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === "text/csv") {
      setFile(droppedFile);
      setResult(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleImport = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("default_stage", defaultStage);

      const response = await fetch("/api/athletes/import", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Import failed");
      }

      setResult(data);
      if (data.success) {
        onComplete(data);
      }
    } catch (error) {
      setResult({
        success: false,
        imported: 0,
        skipped: 0,
        errors: [{ row: 0, error: error instanceof Error ? error.message : "Import failed" }],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setDefaultStage("research");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="w-full max-w-lg border border-brand-line bg-brand-paper-bright">
        <div className="border-b border-brand-line px-5 py-4">
          <h2 id="import-title" className="text-base font-semibold text-brand-ink">Import Athletes from CSV</h2>
          <p className="mt-1 text-sm text-brand-muted">Upload a CSV file with athlete data</p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "cursor-pointer border border-dashed p-6 text-center",
              file ? "border-brand-ink bg-brand-cyan/10" : "border-brand-chrome bg-white hover:border-brand-ink"
            )}
          >
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
            {file ? (
              <div>
                <div className="font-medium text-brand-ink">{file.name}</div>
                <div className="text-sm text-brand-muted">{(file.size / 1024).toFixed(1)} KB</div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setResult(null);
                  }}
                  className="mt-2 text-xs font-medium text-red-700 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <div className="font-medium text-brand-ink">Drop CSV file here</div>
                <div className="text-sm text-brand-muted">or click to browse</div>
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-brand-ink">Default Pipeline Stage</span>
            <select
              value={defaultStage}
              onChange={(e) => setDefaultStage(e.target.value)}
              className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink"
            >
              {STAGES.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-brand-muted">Used when pipeline_stage column is missing</span>
          </label>

          <div className="border-l-2 border-brand-line pl-3 text-xs text-brand-muted">
            <p className="mb-1 text-sm font-medium text-brand-ink">Expected CSV Format</p>
            <p>
              Required columns: <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">name</code>
            </p>
            <p className="mt-1">
              Optional: <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">sport</code>,{" "}
              <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">instagram_handle</code>,{" "}
              <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">email</code>,{" "}
              <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">follower_count</code>,{" "}
              <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">country</code>,{" "}
              <code className="bg-brand-ink/5 px-1 font-mono text-brand-ink">pipeline_stage</code>
            </p>
          </div>

          {result && (
            <div
              role="status"
              className={cn(
                "border p-3 text-sm",
                result.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
              )}
            >
              {result.success ? (
                <div>
                  <p className="font-medium">Import Complete</p>
                  <p className="mt-1">Imported: {result.imported} athletes</p>
                  <p>Skipped (duplicates): {result.skipped}</p>
                  {result.imported_names && result.imported_names.length > 0 && (
                    <p className="mt-1 text-xs">
                      e.g. {result.imported_names.slice(0, 3).join(", ")}
                      {result.imported > 3 && "..."}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="font-medium">Import Failed</p>
                  <div className="mt-1">
                    {result.errors.map((err, i) => (
                      <div key={i}>
                        {err.row > 0 ? `Row ${err.row}: ` : ""}
                        {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
          <button type="button" onClick={handleClose} className="pc-button-secondary">
            {result?.success ? "Close" : "Cancel"}
          </button>
          {!result?.success && (
            <button type="button" onClick={handleImport} disabled={!file || loading} className="pc-button-primary">
              {loading ? "Importing..." : "Import Athletes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
