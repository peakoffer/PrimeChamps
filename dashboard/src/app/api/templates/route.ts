import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

// GET - List all templates
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const activeOnly = searchParams.get("active") !== "false";

    let query = supabase.from("outreach_templates").select("*");

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query.order("times_used", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("Error fetching templates:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST - Create a new template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, content, variables, category } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: "Missing required fields: name, content" },
        { status: 400 }
      );
    }

    // Extract variables from content if not provided
    let templateVariables = variables;
    if (!templateVariables) {
      const matches = content.match(/\{\{(\w+)\}\}/g) || [];
      templateVariables = matches.map((m: string) => m.replace(/\{\{|\}\}/g, ""));
    }

    const { data, error } = await supabase
      .from("outreach_templates")
      .insert({
        name,
        content,
        variables: templateVariables,
        category: category || "initial_outreach",
        is_active: true,
        times_used: 0,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error creating template:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PATCH - Update a template
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing template id" }, { status: 400 });
    }

    // If content is updated, re-extract variables
    if (updates.content && !updates.variables) {
      const matches = updates.content.match(/\{\{(\w+)\}\}/g) || [];
      updates.variables = matches.map((m: string) => m.replace(/\{\{|\}\}/g, ""));
    }

    const { data, error } = await supabase
      .from("outreach_templates")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error updating template:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a template (soft delete by setting is_active = false)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const hard = searchParams.get("hard") === "true";

    if (!id) {
      return NextResponse.json({ error: "Missing template id" }, { status: 400 });
    }

    if (hard) {
      // Hard delete
      const { error } = await supabase
        .from("outreach_templates")
        .delete()
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      // Soft delete
      const { error } = await supabase
        .from("outreach_templates")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: hard ? "Template deleted" : "Template deactivated",
    });
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
