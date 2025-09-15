import { createClient } from "@supabase/supabase-js"

// Type for our form submissions
export type FormSubmission = {
  id?: string
  created_at?: string
  type: "athlete" | "brand" | "partner" // Add "partner" here
  name: string
  email: string
  phone: string
  // Common optional fields
  message?: string | null

  // Athlete specific fields
  sport?: string | null
  other_sport?: string | null
  experience?: string | null
  social_following?: string | null
  instagram?: string | null
  tiktok?: string | null
  youtube?: string | null
  twitter?: string | null
  achievements?: string | null
  sponsorships?: string | null
  goals?: string | null

  // Brand specific fields
  company?: string | null
  role?: string | null
  website?: string | null
  industry?: string | null
  budget?: string | null
  target_sports?: string | null
  campaign_goals?: string | null
  target_audience?: string | null
  timeline?: string | null

  // Metadata
  ip_address?: string | null
  user_agent?: string | null
  referrer?: string | null
  status?: "new" | "contacted" | "qualified" | "rejected" | null
}

// Initialize the Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// Helper function to create the submissions table if it doesn't exist
export async function ensureSubmissionsTable() {
  // Check if the table exists
  const { data, error } = await supabase.from("form_submissions").select("id").limit(1)

  if (error && error.code === "42P01") {
    console.log("Table does not exist, creating it...")
    // Table doesn't exist, create it using SQL
    // Note: This is a simplified approach. In production, you might want to use migrations.
    const { error: createError } = await supabase.rpc("create_submissions_table")

    if (createError) {
      console.error("Error creating table:", createError)
      throw createError
    }

    console.log("Table created successfully")
  } else if (error) {
    console.error("Error checking table:", error)
    throw error
  }
}

// Function to save a form submission
export async function saveFormSubmission(submission: FormSubmission) {
  await ensureSubmissionsTable()

  const { data, error } = await supabase.from("form_submissions").insert([submission]).select()

  if (error) {
    console.error("Error saving submission:", error)
    throw error
  }

  return data[0]
}

// Function to get all form submissions
export async function getFormSubmissions() {
  const { data, error } = await supabase.from("form_submissions").select("*").order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching submissions:", error)
    throw error
  }

  return data
}

// Function to get a single form submission
export async function getFormSubmission(id: string) {
  const { data, error } = await supabase.from("form_submissions").select("*").eq("id", id).single()

  if (error) {
    console.error("Error fetching submission:", error)
    throw error
  }

  return data
}

// Function to update a form submission status
export async function updateSubmissionStatus(id: string, status: FormSubmission["status"]) {
  const { data, error } = await supabase.from("form_submissions").update({ status }).eq("id", id).select()

  if (error) {
    console.error("Error updating submission:", error)
    throw error
  }

  return data[0]
}
