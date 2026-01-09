import { NextRequest, NextResponse } from "next/server";
import {
  getEmailTemplates,
  createEmailTemplate,
} from "@/lib/email-service";

// GET /api/email/templates - List email templates
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category") || undefined;
    const activeOnly = searchParams.get("active_only") !== "false";

    const templates = await getEmailTemplates({
      category,
      activeOnly,
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Error in GET /api/email/templates:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/email/templates - Create new template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, subject, body: templateBody, variables, category } = body;

    if (!name || !subject || !templateBody) {
      return NextResponse.json(
        { error: "name, subject, and body are required" },
        { status: 400 }
      );
    }

    const template = await createEmailTemplate({
      name,
      subject,
      body: templateBody,
      variables: variables || [],
      category: category || "initial_outreach",
    });

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error in POST /api/email/templates:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
