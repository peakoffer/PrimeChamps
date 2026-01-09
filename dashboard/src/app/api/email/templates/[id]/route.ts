import { NextRequest, NextResponse } from "next/server";
import { getEmailTemplate, updateEmailTemplate } from "@/lib/email-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/email/templates/[id] - Get single template
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const template = await getEmailTemplate(id);

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error in GET /api/email/templates/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PUT /api/email/templates/[id] - Update template
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate template exists
    const existing = await getEmailTemplate(id);
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Extract allowed update fields
    const updates: Record<string, unknown> = {};
    const allowedFields = [
      "name",
      "subject",
      "body",
      "variables",
      "category",
      "is_active",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const template = await updateEmailTemplate(id, updates);
    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error in PUT /api/email/templates/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE /api/email/templates/[id] - Soft delete (set inactive)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Validate template exists
    const existing = await getEmailTemplate(id);
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Soft delete by setting is_active to false
    await updateEmailTemplate(id, { is_active: false });

    return NextResponse.json({ success: true, message: "Template deactivated" });
  } catch (error) {
    console.error("Error in DELETE /api/email/templates/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
