"use client";

import { useState, useEffect } from "react";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  category: string;
  is_active: boolean;
  times_used: number;
  open_rate: number | null;
  reply_rate: number | null;
}

interface EmailTemplateEditorProps {
  template?: EmailTemplate;
  onSave: (data: {
    name: string;
    subject: string;
    body: string;
    variables: string[];
    category: string;
  }) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const AVAILABLE_VARIABLES = [
  { key: "first_name", description: "Athlete's first name" },
  { key: "name", description: "Athlete's full name" },
  { key: "sport", description: "Athlete's sport" },
];

const CATEGORIES = [
  { value: "initial_outreach", label: "Initial Outreach" },
  { value: "follow_up", label: "Follow Up" },
  { value: "appointment", label: "Appointment" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Other" },
];

export default function EmailTemplateEditor({
  template,
  onSave,
  onCancel,
  isLoading = false,
}: EmailTemplateEditorProps) {
  const [name, setName] = useState(template?.name || "");
  const [subject, setSubject] = useState(template?.subject || "");
  const [body, setBody] = useState(template?.body || "");
  const [category, setCategory] = useState(template?.category || "initial_outreach");
  const [usedVariables, setUsedVariables] = useState<string[]>([]);

  // Detect variables used in template
  useEffect(() => {
    const allText = `${subject} ${body}`;
    const detected = AVAILABLE_VARIABLES.filter((v) =>
      allText.includes(`{{${v.key}}}`) || allText.includes(`{{ ${v.key} }}`)
    ).map((v) => v.key);
    setUsedVariables(detected);
  }, [subject, body]);

  const insertVariable = (variable: string) => {
    const insertion = `{{${variable}}}`;
    setBody((prev) => prev + insertion);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !subject.trim() || !body.trim()) return;

    await onSave({
      name: name.trim(),
      subject: subject.trim(),
      body: body.trim(),
      variables: usedVariables,
      category,
    });
  };

  // Sample data for preview
  const sampleData: Record<string, string> = {
    first_name: "Sarah",
    name: "Sarah Johnson",
    sport: "Tennis",
  };

  const getPreview = (text: string) => {
    let result = text;
    for (const [key, value] of Object.entries(sampleData)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
      result = result.replace(regex, value);
    }
    return result;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {template ? "Edit Template" : "Create Template"}
            </h2>
            <p className="text-sm text-gray-600">
              Create reusable email templates with personalization variables
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid grid-cols-2 gap-6">
            {/* Left Column - Editor */}
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Initial Outreach - Casual"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject Line
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Partnership Opportunity for {{first_name}}"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              {/* Variables */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Insert Variable
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                      title={v.description}
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Body (HTML)
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="<p>Hey {{first_name}},</p>..."
                  rows={12}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                  required
                />
              </div>
            </div>

            {/* Right Column - Preview */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Preview (with sample data)
                </label>
                <div className="border rounded-lg overflow-hidden">
                  {/* Subject Preview */}
                  <div className="px-4 py-2 bg-gray-100 border-b">
                    <span className="text-xs text-gray-500 uppercase">Subject:</span>
                    <p className="font-medium text-gray-900">{getPreview(subject) || "..."}</p>
                  </div>

                  {/* Body Preview */}
                  <div className="p-4 bg-white min-h-[300px]">
                    {body ? (
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: getPreview(body) }}
                      />
                    ) : (
                      <p className="text-gray-400 italic">Email body preview will appear here...</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Variables Used */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Variables Detected
                </label>
                <div className="flex flex-wrap gap-1">
                  {usedVariables.length > 0 ? (
                    usedVariables.map((v) => (
                      <span
                        key={v}
                        className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded"
                      >
                        {v}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500 italic">
                      No variables used yet
                    </span>
                  )}
                </div>
              </div>

              {/* Template Stats (if editing) */}
              {template && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Template Stats</h4>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">
                        {template.times_used}
                      </div>
                      <div className="text-xs text-gray-500">Times Used</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-gray-900">
                        {template.open_rate ? `${template.open_rate.toFixed(1)}%` : "—"}
                      </div>
                      <div className="text-xs text-gray-500">Open Rate</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-gray-900">
                        {template.reply_rate ? `${template.reply_rate.toFixed(1)}%` : "—"}
                      </div>
                      <div className="text-xs text-gray-500">Reply Rate</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isLoading || !name.trim() || !subject.trim() || !body.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Saving..." : template ? "Update Template" : "Create Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
