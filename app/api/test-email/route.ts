import { NextResponse } from "next/server"
import { Resend } from "resend"

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: Request) {
  try {
    // Only allow this in development
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json(
        {
          success: false,
          message: "This endpoint is only available in development mode",
        },
        { status: 403 },
      )
    }

    const result = await resend.emails.send({
      from: "Prime Champs <onboarding@resend.dev>", // Use this address for testing
      to: "your-email@example.com", // Replace with your actual email
      subject: "Test Email from Prime Champs",
      html: `
        <h1>Email Integration Test</h1>
        <p>This is a test email to verify that your Resend integration is working correctly.</p>
        <p>If you're seeing this, your email notifications for form submissions should be working!</p>
      `,
    })

    return NextResponse.json({
      success: true,
      message: "Test email sent successfully",
      data: result,
    })
  } catch (error) {
    console.error("Error sending test email:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to send test email",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
