import { NextResponse } from "next/server"
import { Resend } from "resend"
import { saveFormSubmission, type FormSubmission } from "@/lib/supabase"

// Initialize Resend for email
const resend = new Resend(process.env.RESEND_API_KEY)

// Simple in-memory rate limiting
// In production, consider using Redis or another persistent store
const RATE_LIMIT_DURATION = 60 * 1000 // 1 minute
const MAX_REQUESTS = 5 // 5 requests per minute
const ipRequests = new Map<string, { count: number; timestamp: number }>()

export async function POST(request: Request) {
  try {
    // Get client IP for rate limiting
    const ip = request.headers.get("x-forwarded-for") || "unknown"

    // Check rate limit
    const now = Date.now()
    const ipData = ipRequests.get(ip) || { count: 0, timestamp: now }

    // Reset count if time window has passed
    if (now - ipData.timestamp > RATE_LIMIT_DURATION) {
      ipData.count = 0
      ipData.timestamp = now
    }

    // Check if rate limit exceeded
    if (ipData.count >= MAX_REQUESTS) {
      return NextResponse.json(
        { success: false, message: "Too many requests. Please try again later." },
        { status: 429 },
      )
    }

    // Increment request count
    ipData.count++
    ipRequests.set(ip, ipData)

    // Get the form data from the request
    const formData = await request.json()

    // Check honeypot field
    if (formData.website_url) {
      // This is likely a bot - silently accept but don't process
      // We return success to avoid giving bots feedback
      return NextResponse.json({
        success: true,
        message: "Form submitted successfully",
      })
    }

    // Get metadata for analytics
    const userAgent = request.headers.get("user-agent") || "unknown"
    const referrer = request.headers.get("referer") || null

    // Prepare data for Supabase
    const submissionData: FormSubmission = {
      type: formData.type,
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      message: formData.message || null,
      ip_address: ip,
      user_agent: userAgent,
      referrer: referrer,
      status: "new",
    }

    // Add type-specific fields
    if (formData.type === "athlete") {
      submissionData.sport = formData.sport
      submissionData.other_sport = formData.sport === "other" ? formData.otherSport : null
      submissionData.experience = formData.experience
      submissionData.social_following = formData.socialFollowing
      submissionData.instagram = formData.instagram || null
      submissionData.tiktok = formData.tiktok || null
      submissionData.youtube = formData.youtube || null
      submissionData.twitter = formData.twitter || null
      submissionData.achievements = formData.achievements
      submissionData.sponsorships = formData.sponsorships || null
      submissionData.goals = formData.goals
    } else if (formData.type === "brand") {
      submissionData.company = formData.company
      submissionData.role = formData.role
      submissionData.website = formData.website || null
      submissionData.industry = formData.industry
      submissionData.budget = formData.budget
      submissionData.target_sports = formData.targetSports
      submissionData.campaign_goals = formData.campaignGoals
      submissionData.target_audience = formData.targetAudience
      submissionData.timeline = formData.timeline
    }

    // Save to Supabase
    const savedSubmission = await saveFormSubmission(submissionData)

    // Send email notification
    const emailType = formData.type === "athlete" ? "Athlete" : "Brand"

    // If you've verified your domain, update this line:
    await resend.emails.send({
      from: "Prime Champs <forms@your-verified-domain.com>", // Update with your verified domain
      to: "your-email@example.com", // Update with your notification email
      subject: `New ${emailType} Form Submission`,
      html: `
        <h1>New ${emailType} Form Submission</h1>
        <p><strong>Name:</strong> ${formData.name}</p>
        <p><strong>Email:</strong> ${formData.email}</p>
        <p><strong>Phone:</strong> ${formData.phone}</p>
        ${
          formData.type === "athlete"
            ? `<p><strong>Sport:</strong> ${formData.sport === "other" ? formData.otherSport : formData.sport}</p>
             <p><strong>Experience:</strong> ${formData.experience}</p>
             <p><strong>Social Following:</strong> ${formData.socialFollowing}</p>`
            : `<p><strong>Company:</strong> ${formData.company}</p>
             <p><strong>Role:</strong> ${formData.role}</p>
             <p><strong>Industry:</strong> ${formData.industry}</p>`
        }
        <p><strong>Message:</strong> ${formData.message || "No message provided"}</p>
        <p>View the full submission in your dashboard: ${process.env.NEXT_PUBLIC_SITE_URL}/admin/submissions/${savedSubmission.id}</p>
      `,
    })

    // Return a success response
    return NextResponse.json({
      success: true,
      message: "Form submitted successfully",
      id: savedSubmission.id,
    })
  } catch (error) {
    console.error("Error processing form submission:", error)

    // Return an error response
    return NextResponse.json({ success: false, message: "Error processing your request" }, { status: 500 })
  }
}
