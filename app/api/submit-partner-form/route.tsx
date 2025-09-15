import { NextResponse } from "next/server"
import { Resend } from "resend"
import { saveFormSubmission, type FormSubmission } from "@/lib/supabase"

// Initialize Resend for email
const resend = new Resend(process.env.RESEND_API_KEY)

// Simple in-memory rate limiting
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
      return NextResponse.json({
        success: true,
        message: "Form submitted successfully",
      })
    }

    // Get metadata for analytics
    const userAgent = request.headers.get("user-agent") || "unknown"
    const referrer = request.headers.get("referer") || null

    // Prepare data for Supabase - we'll store partner form data with type "partner"
    const submissionData: FormSubmission = {
      type: "partner" as any, // We'll need to update our type definition
      name: `${formData.firstName} ${formData.lastName}`,
      email: formData.email,
      phone: formData.phone || null,
      message: formData.message,
      ip_address: ip,
      user_agent: userAgent,
      referrer: referrer,
      status: "new",
      // Store partner-specific data in the message field or create new fields
      goals: `Interest: ${formData.interest}`, // Reusing the goals field for interest
    }

    // Save to Supabase
    const savedSubmission = await saveFormSubmission(submissionData)

    // Send email notification
    await resend.emails.send({
      from: "Prime Champs <onboarding@resend.dev>", // Use default for now
      to: "zac@prime-champs.com", // Your email address
      subject: "New Partnership Inquiry",
      html: `
        <h1>New Partnership Inquiry</h1>
        <p><strong>Name:</strong> ${formData.firstName} ${formData.lastName}</p>
        <p><strong>Email:</strong> ${formData.email}</p>
        <p><strong>Phone:</strong> ${formData.phone || "Not provided"}</p>
        <p><strong>Interest:</strong> ${formData.interest}</p>
        <p><strong>Message:</strong> ${formData.message}</p>
        <p>View the full submission in your dashboard: ${process.env.NEXT_PUBLIC_SITE_URL}/admin/submissions/${savedSubmission.id}</p>
      `,
    })

    // Return a success response
    return NextResponse.json({
      success: true,
      message: "Partnership inquiry submitted successfully",
      id: savedSubmission.id,
    })
  } catch (error) {
    console.error("Error processing partner form submission:", error)

    // Return an error response
    return NextResponse.json({ success: false, message: "Error processing your request" }, { status: 500 })
  }
}
