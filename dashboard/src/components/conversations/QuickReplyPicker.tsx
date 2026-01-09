"use client";

import { useState, useEffect, useRef } from "react";

interface Template {
  id: string;
  name: string;
  content: string;
  variables?: string[];
  category?: string;
}

interface AthleteData {
  name?: string;
  sport?: string;
  instagram_handle?: string;
  follower_count?: number;
}

interface QuickReplyPickerProps {
  onSelect: (content: string, templateId: string) => void;
  athleteData?: AthleteData;
}

export default function QuickReplyPicker({
  onSelect,
  athleteData,
}: QuickReplyPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && templates.length === 0) {
      fetchTemplates();
    }
  }, [isOpen]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/templates?active=true");
      const data = await response.json();
      setTemplates(data.data || data.templates || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
      // Fall back to default templates
      setTemplates(getDefaultTemplates());
    } finally {
      setLoading(false);
    }
  };

  const getDefaultTemplates = (): Template[] => [
    {
      id: "default-1",
      name: "Casual Introduction",
      content: "Hey {{first_name}}! I've been following your journey and I'm really impressed with what you've built. Would love to chat if you're open to it!",
      variables: ["first_name"],
      category: "initial_outreach",
    },
    {
      id: "default-2",
      name: "Follow-up",
      content: "Hey {{first_name}}, just wanted to follow up on my last message. Let me know if you have 5 minutes to chat.",
      variables: ["first_name"],
      category: "follow_up",
    },
    {
      id: "default-3",
      name: "Interest Response",
      content: "That's great to hear! I'd love to tell you more. Are you free for a quick 15-minute call this week?",
      variables: [],
      category: "follow_up",
    },
  ];

  const personalizeTemplate = (content: string): string => {
    if (!athleteData) return content;

    const firstName = athleteData.name?.split(" ")[0] || "there";
    const sport = athleteData.sport || "your sport";
    const handle = athleteData.instagram_handle || "";

    return content
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{sport\}\}/g, sport)
      .replace(/\{\{instagram_handle\}\}/g, handle)
      .replace(/\{\{name\}\}/g, athleteData.name || "there");
  };

  const handleSelect = (template: Template) => {
    const personalizedContent = personalizeTemplate(template.content);
    onSelect(personalizedContent, template.id);
    setIsOpen(false);
  };

  const groupedTemplates = templates.reduce((acc, template) => {
    const category = template.category || "other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {} as Record<string, Template[]>);

  const categoryLabels: Record<string, string> = {
    initial_outreach: "Initial Outreach",
    follow_up: "Follow-up",
    other: "Other",
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
      >
        <span>Templates</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 w-80 bg-white rounded-lg shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-50">
          {loading ? (
            <div className="p-4 text-center text-gray-500">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No templates available</div>
          ) : (
            <div className="py-2">
              {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                <div key={category}>
                  <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase bg-gray-50">
                    {categoryLabels[category] || category}
                  </div>
                  {categoryTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleSelect(template)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                    >
                      <div className="font-medium text-gray-900 text-sm">
                        {template.name}
                      </div>
                      <div className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                        {personalizeTemplate(template.content)}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
