"use client";

import { useState, useRef } from "react";

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Import Athletes from CSV</h2>
          <p className="text-sm text-gray-600 mt-1">
            Upload a CSV file with athlete data
          </p>
        </div>

        <div className="p-6 space-y-4">
          {/* File Upload Area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              file
                ? "border-green-300 bg-green-50"
                : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div>
                <div className="text-4xl mb-2">📄</div>
                <div className="font-medium text-gray-900">{file.name}</div>
                <div className="text-sm text-gray-600">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setResult(null);
                  }}
                  className="mt-2 text-sm text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <div className="text-4xl mb-2">📁</div>
                <div className="font-medium text-gray-900">Drop CSV file here</div>
                <div className="text-sm text-gray-600">or click to browse</div>
              </div>
            )}
          </div>

          {/* Default Stage Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Pipeline Stage
            </label>
            <select
              value={defaultStage}
              onChange={(e) => setDefaultStage(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {STAGES.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Used when pipeline_stage column is missing
            </p>
          </div>

          {/* CSV Format Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Expected CSV Format</h4>
            <p className="text-xs text-gray-600 mb-2">
              Required columns: <code className="bg-gray-200 px-1 rounded">name</code>
            </p>
            <p className="text-xs text-gray-600">
              Optional: <code className="bg-gray-200 px-1 rounded">sport</code>,{" "}
              <code className="bg-gray-200 px-1 rounded">instagram_handle</code>,{" "}
              <code className="bg-gray-200 px-1 rounded">email</code>,{" "}
              <code className="bg-gray-200 px-1 rounded">follower_count</code>,{" "}
              <code className="bg-gray-200 px-1 rounded">country</code>,{" "}
              <code className="bg-gray-200 px-1 rounded">pipeline_stage</code>
            </p>
          </div>

          {/* Import Result */}
          {result && (
            <div
              className={`rounded-lg p-4 ${
                result.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
              }`}
            >
              {result.success ? (
                <div>
                  <div className="font-medium text-green-800 mb-2">Import Complete</div>
                  <div className="text-sm text-green-700">
                    <div>Imported: {result.imported} athletes</div>
                    <div>Skipped (duplicates): {result.skipped}</div>
                  </div>
                  {result.imported_names && result.imported_names.length > 0 && (
                    <div className="mt-2 text-xs text-green-600">
                      e.g. {result.imported_names.slice(0, 3).join(", ")}
                      {result.imported > 3 && "..."}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="font-medium text-red-800 mb-2">Import Failed</div>
                  <div className="text-sm text-red-700">
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

        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            {result?.success ? "Close" : "Cancel"}
          </button>
          {!result?.success && (
            <button
              onClick={handleImport}
              disabled={!file || loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Importing..." : "Import Athletes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
