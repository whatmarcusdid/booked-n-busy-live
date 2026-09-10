import { NextRequest, NextResponse } from "next/server";
import { createResendProvider } from "@/lib/email/resend";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import {
  createSupabaseManualReviewStore,
  requestManualReview,
} from "@/lib/services/manual-review";

const NOT_AVAILABLE = { error: "Request not available" };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "manual-review"),
    5,
    60_000,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...PUBLIC_TOKEN_HEADERS, "Retry-After": "60" } },
    );
  }

  const { token } = await context.params;
  if (!token) {
    return NextResponse.json(NOT_AVAILABLE, {
      status: 404,
      headers: PUBLIC_TOKEN_HEADERS,
    });
  }

  const result = await requestManualReview({
    statusToken: token,
    store: createSupabaseManualReviewStore(),
    provider: createResendProvider(),
  });

  if (!result.ok) {
    if (result.reason === "send_failed") {
      return NextResponse.json(
        { error: "Could not send request." },
        { status: 502, headers: PUBLIC_TOKEN_HEADERS },
      );
    }
    return NextResponse.json(NOT_AVAILABLE, {
      status: 404,
      headers: PUBLIC_TOKEN_HEADERS,
    });
  }

  return NextResponse.json(
    { ok: true, alreadyRequested: result.alreadyRequested },
    { status: 200, headers: PUBLIC_TOKEN_HEADERS },
  );
}
