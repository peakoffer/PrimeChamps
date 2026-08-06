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
