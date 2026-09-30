"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
        aria-expanded={isOpen}
        className="flex items-center gap-1 border border-brand-line bg-brand-paper-bright px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-ink"
      >
        Templates
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-50 mb-2 max-h-96 w-80 overflow-y-auto border border-brand-line bg-brand-paper-bright">
          {loading ? (
            <p className="p-4 text-center text-sm text-brand-muted">Loading templates...</p>
          ) : templates.length === 0 ? (
            <p className="p-4 text-center text-sm text-brand-muted">No templates available</p>
          ) : (
            <div className="py-1">
              {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                <div key={category}>
                  <div className="bg-brand-paper px-3 py-1 text-xs font-medium text-brand-muted">
                    {categoryLabels[category] || category}
                  </div>
                  {categoryTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleSelect(template)}
                      className="w-full border-b border-brand-ink/10 px-3 py-2 text-left last:border-b-0 hover:bg-brand-cyan/10"
                    >
                      <div className="text-sm font-medium text-brand-ink">{template.name}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-brand-muted">
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
