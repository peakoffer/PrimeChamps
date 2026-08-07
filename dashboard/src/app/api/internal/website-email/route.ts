import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

type LeadType = "athlete" | "brand";

function authorized(request: NextRequest) {
  const expected = process.env.WEBSITE_INTAKE_SHARED_SECRET?.trim() || "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return Boolean(expected && provided && left.length === right.length && timingSafeEqual(left, right));
}

function clean(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}

async function sendEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  replyTo?: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM_ADDRESS?.trim() || process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return NextResponse.json({ error: "Email delivery is not configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const leadId = clean(body?.lead_id, 100);
  const leadType = clean(body?.lead_type, 20) as LeadType;
  const fullName = clean(body?.full_name, 120);
  const email = clean(body?.email, 254).toLowerCase();
  const phone = clean(body?.phone, 50);
  const detailsValue = body?.details;
  const details = detailsValue && typeof detailsValue === "object" && !Array.isArray(detailsValue)
    ? Object.fromEntries(Object.entries(detailsValue).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  if (!leadId || !["athlete", "brand"].includes(leadType) || !fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid delivery request" }, { status: 400 });
  }

  const result: {
    internal_sent: boolean;
    confirmation_sent: boolean;
    internal_error?: string;
    confirmation_error?: string;
  } = { internal_sent: false, confirmation_sent: false };

  const summary = Object.entries(details)
    .map(([key, value]) => `<li><strong>${escapeHtml(key.replaceAll("_", " "))}:</strong> ${escapeHtml(clean(value))}</li>`)
    .join("");
  try {
    await sendEmail({
      apiKey,
      from,
      to: process.env.LEAD_NOTIFICATION_EMAIL?.trim() || "info@prime-champs.com",
      replyTo: email,
      idempotencyKey: `website-lead-internal-${leadId}`,
      subject: `New Prime Champs ${leadType} inquiry — ${fullName}`,
      html: `<h1>New ${escapeHtml(leadType)} inquiry</h1><p><strong>Name:</strong> ${escapeHtml(fullName)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p>${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ""}<ul>${summary}</ul>`,
    });
    result.internal_sent = true;
  } catch (error) {
    result.internal_error = error instanceof Error ? error.message.slice(0, 1_000) : "Unknown delivery error";
  }

  const confirmationIntro = leadType === "athlete"
    ? "Your athlete profile is now in our direct review queue. If there is a strong fit and a clear next step, Prime Champs will contact you by email."
    : "Your campaign brief is now in our review queue. We will review the objective, timing, and athlete fit, then follow up by email.";
  try {
    await sendEmail({
      apiKey,
      from,
      to: email,
      idempotencyKey: `website-lead-confirmation-${leadId}`,
      subject: leadType === "athlete" ? "Prime Champs received your athlete profile" : "Prime Champs received your campaign brief",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#121826"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2161ff">Prime Champs</p><h1 style="font-size:28px">We received it, ${escapeHtml(fullName)}.</h1><p style="line-height:1.6">${confirmationIntro}</p><p style="line-height:1.6">No extra action is needed right now.</p><p style="margin-top:32px;color:#596273">Prime Champs<br>Two sides. One standard.</p></div>`,
    });
    result.confirmation_sent = true;
  } catch (error) {
    result.confirmation_error = error instanceof Error ? error.message.slice(0, 1_000) : "Unknown delivery error";
  }

  return NextResponse.json(result);
}
