import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import { submitPreCallAnswers } from "@/lib/pre-call/answers";
import { scheduleHandoffPath } from "@/lib/copy/pre-call";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const bodySchema = z.object({
  statusToken: z.string().min(1),
  findingAnswer: z.string().nullable().optional(),
  resultAnswer: z.string().nullable().optional(),
  timingAnswer: z.string().nullable().optional(),
});

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PUBLIC_TOKEN_HEADERS, ...extra },
  });
}

export async function POST(request: NextRequest) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "pre-call-answers"),
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!parsed.success) {
    return json({ error: "Invalid request" }, 400);
  }

  try {
    const result = await submitPreCallAnswers(parsed.data);

    if (!result.ok) {
      if (result.reason === "not_found") {
        return json({ error: "Not available" }, 404);
      }
      if (result.reason === "invalid_option") {
        return json({ error: "Invalid request" }, 400);
      }
      return json({ error: "Could not save answers." }, 500);
    }

    return json(
      { id: result.id, scheduleUrl: scheduleHandoffPath(parsed.data.statusToken) },
      201,
    );
  } catch (error) {
    console.error("Failed to save pre-call answers:", error);
    return json({ error: "Could not save answers." }, 500);
  }
}
