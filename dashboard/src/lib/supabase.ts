import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for database tables
export interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_url: string | null;
  instagram_handle: string | null;
  email: string | null;
  profile_url: string | null;
  wikipedia_url: string | null;
  follower_count: number | null;
  engagement_rate: number | null;
  country: string | null;
  age: number | null;
  notes: string | null;
  enrichment_status: "pending" | "enriched" | "failed";
  source: "seed_data" | "research_agent" | "manual";
  pipeline_stage: string | null;
  created_at: string;
  updated_at: string;
  // New fields from migration v2
  profile_pic_url: string | null;
  tiktok_handle: string | null;
  tiktok_url: string | null;
  twitter_handle: string | null;
  twitter_url: string | null;
  has_onlyfans: boolean | null;
  onlyfans_url: string | null;
}

export interface OutreachMessage {
  id: string;
  athlete_id: string;
  campaign_id: string | null;
  message_content: string;
  personalization_data: Record<string, unknown>;
  status: "draft" | "pending_approval" | "approved" | "sent" | "delivered" | "read" | "replied" | "declined";
  approval_status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  response_received_at: string | null;
  response_content: string | null;
  created_at: string;
  athletes?: Athlete;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "completed";
  message_template: string | null;
  target_sports: string[] | null;
  created_at: string;
  updated_at: string;
}

// API functions
export async function getAthletes(filters?: {
  sport?: string;
  enrichmentStatus?: string;
  limit?: number;
}) {
  let query = supabase.from("athletes").select("*");

  if (filters?.sport) {
    query = query.eq("sport", filters.sport);
  }
  if (filters?.enrichmentStatus) {
    query = query.eq("enrichment_status", filters.enrichmentStatus);
  }

  query = query.limit(filters?.limit || 100).order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data as Athlete[];
}

export async function getAthlete(id: string) {
  const { data, error } = await supabase
    .from("athletes")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Athlete;
}

export async function getPendingApprovals() {
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*, athletes(*)")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as OutreachMessage[];
}

export async function approveMessage(messageId: string, approvedBy: string) {
  const { data, error } = await supabase
    .from("outreach_messages")
    .update({
      approval_status: "approved",
      status: "approved",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function rejectMessage(messageId: string, approvedBy: string) {
  const { data, error } = await supabase
    .from("outreach_messages")
    .update({
      approval_status: "rejected",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getStats() {
  const [athletes, messages] = await Promise.all([
    supabase.from("athletes").select("sport, enrichment_status", { count: "exact" }),
    supabase.from("outreach_messages").select("status, approval_status", { count: "exact" }),
  ]);

  return {
    totalAthletes: athletes.count || 0,
    totalMessages: messages.count || 0,
    athletes: athletes.data || [],
    messages: messages.data || [],
  };
}
