import { NextRequest, NextResponse } from "next/server";
import { applyEmailWebhookEvent } from "@/lib/email/service";
import { verifyResendSignature } from "@/lib/email/webhook";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("resend-signature");
  if (!verifyResendSignature(raw, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    id?: string;
    type?: string;
    data?: { email_id?: string };
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const type = mapResendType(body.type);
  if (!body.id || !body.data?.email_id || !type) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const result = await applyEmailWebhookEvent({
    eventId: body.id,
    providerMessageId: body.data.email_id,
    type,
  });

  return NextResponse.json({ ok: true, result }, { status: 200 });
}

function mapResendType(
  type: string | undefined,
): "sent" | "delivered" | "bounced" | "failed" | null {
  if (type === "email.sent") return "sent";
  if (type === "email.delivered") return "delivered";
  if (type === "email.bounced") return "bounced";
  if (type === "email.failed" || type === "email.complained") return "failed";
  return null;
}
