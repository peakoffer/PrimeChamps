"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import EmailTemplateEditor from "@/components/EmailTemplateEditor";

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
  created_at: string;
  updated_at: string;
}

const categoryLabels: Record<string, string> = {
  initial_outreach: "Initial Outreach",
  follow_up: "Follow Up",
  appointment: "Appointment",
  contract: "Contract",
  other: "Other",
};

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | undefined>();
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [showInactive]);

  const fetchTemplates = async () => {
    try {
      const params = new URLSearchParams();
      params.set("active_only", showInactive ? "false" : "true");

      const response = await fetch(`/api/email/templates?${params}`);
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(undefined);
    setShowEditor(true);
  };

  const handleEditTemplate = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setShowEditor(true);
  };

  const handleSaveTemplate = async (data: {
    name: string;
    subject: string;
    body: string;
    variables: string[];
    category: string;
  }) => {
    setSaving(true);
    try {
      const url = editingTemplate
        ? `/api/email/templates/${editingTemplate.id}`
        : "/api/email/templates";

      const method = editingTemplate ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error("Failed to save template");
      }

      await fetchTemplates();
      setShowEditor(false);
      setEditingTemplate(undefined);
    } catch (error) {
      console.error("Error saving template:", error);
      alert("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (template: EmailTemplate) => {
    try {
      const response = await fetch(`/api/email/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !template.is_active }),
      });

      if (!response.ok) {
        throw new Error("Failed to update template");
      }

      await fetchTemplates();
    } catch (error) {
      console.error("Error toggling template:", error);
    }
  };

  const filteredTemplates = filterCategory
    ? templates.filter((t) => t.category === filterCategory)
    : templates;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/pipeline" className="text-gray-600 hover:text-gray-800">
            ← Pipeline
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
            <p className="text-gray-600">Manage reusable email templates for outreach</p>
          </div>
        </div>
        <button
          onClick={handleCreateTemplate}
          className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium"
        >
          + Create Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Categories</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive templates
        </label>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">
            {templates.filter((t) => t.is_active).length}
          </div>
          <div className="text-sm text-gray-600">Active Templates</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">
            {templates.reduce((sum, t) => sum + t.times_used, 0)}
          </div>
          <div className="text-sm text-gray-600">Total Uses</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">
            {templates.length > 0
              ? `${(
                  templates
                    .filter((t) => t.open_rate)
                    .reduce((sum, t) => sum + (t.open_rate || 0), 0) /
                    templates.filter((t) => t.open_rate).length || 0
                ).toFixed(1)}%`
              : "—"}
          </div>
          <div className="text-sm text-gray-600">Avg Open Rate</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">
            {templates.length > 0
              ? `${(
                  templates
                    .filter((t) => t.reply_rate)
                    .reduce((sum, t) => sum + (t.reply_rate || 0), 0) /
                    templates.filter((t) => t.reply_rate).length || 0
                ).toFixed(1)}%`
              : "—"}
          </div>
          <div className="text-sm text-gray-600">Avg Reply Rate</div>
        </div>
      </div>

      {/* Templates List */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">📧</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Templates Found</h3>
          <p className="text-sm text-gray-600 mb-4">
            Create your first email template to get started with email outreach.
          </p>
          <button
            onClick={handleCreateTemplate}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
          >
            Create Template
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className={`bg-white border rounded-lg p-4 ${
                !template.is_active ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{template.name}</h3>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                      {categoryLabels[template.category] || template.category}
                    </span>
                    {!template.is_active && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-600">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">Subject:</span> {template.subject}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>Used {template.times_used} times</span>
                    {template.open_rate && (
                      <span>{template.open_rate.toFixed(1)}% open rate</span>
                    )}
                    {template.reply_rate && (
                      <span>{template.reply_rate.toFixed(1)}% reply rate</span>
                    )}
                    {template.variables.length > 0 && (
                      <span>Variables: {template.variables.join(", ")}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEditTemplate(template)}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleActive(template)}
                    className={`px-3 py-1.5 text-sm rounded ${
                      template.is_active
                        ? "bg-red-100 text-red-700 hover:bg-red-200"
                        : "bg-green-100 text-green-700 hover:bg-green-200"
                    }`}
                  >
                    {template.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <EmailTemplateEditor
          template={editingTemplate}
          onSave={handleSaveTemplate}
          onCancel={() => {
            setShowEditor(false);
            setEditingTemplate(undefined);
          }}
          isLoading={saving}
        />
      )}
    </div>
  );
}
