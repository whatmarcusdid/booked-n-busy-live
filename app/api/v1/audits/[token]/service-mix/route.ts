import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SERVICE_MIX_SELECTION_IDS } from "@/lib/copy/audit-service-mix";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import { saveLeadServiceMix } from "@/lib/leads/service-mix";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const NOT_AVAILABLE = { error: "Not available" };

const bodySchema = z.object({
  selection: z.enum(SERVICE_MIX_SELECTION_IDS),
});

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PUBLIC_TOKEN_HEADERS, ...extra },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "service-mix"),
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  const { token } = await context.params;
  if (!token) {
    return json(NOT_AVAILABLE, 404);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: "Invalid request" }, 400);
  }

  try {
    const result = await saveLeadServiceMix(token, parsed.data.selection);
    if (!result.ok) {
      if (result.reason === "invalid_option") {
        return json({ error: "Invalid request" }, 400);
      }
      if (result.reason === "not_found") {
        return json(NOT_AVAILABLE, 404);
      }
      return json({ error: "Could not save selection." }, 500);
    }
    return json({ ok: true }, 200);
  } catch (error) {
    console.error("Failed to save service mix:", error);
    return json({ error: "Could not save selection." }, 500);
  }
}
