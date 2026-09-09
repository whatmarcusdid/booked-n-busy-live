import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import { retryAuditByStatusToken } from "@/lib/services/audit-retry-service";

/** Same neutral body for every miss, so this cannot be used to probe tokens. */
const RETRY_NOT_AVAILABLE = { error: "Retry not available" };

/**
 * Customer-facing manual retry after a transient failure (decision #11 rule
 * 10). Creates a new execution; it never resumes the failed audit.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "audit-retry"),
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
    return NextResponse.json(RETRY_NOT_AVAILABLE, {
      status: 404,
      headers: PUBLIC_TOKEN_HEADERS,
    });
  }

  const result = await retryAuditByStatusToken(token);

  if (!result.ok) {
    if (result.reason === "already_retried") {
      return NextResponse.json(
        { error: "This audit has already been retried" },
        { status: 409, headers: PUBLIC_TOKEN_HEADERS },
      );
    }
    return NextResponse.json(RETRY_NOT_AVAILABLE, {
      status: 404,
      headers: PUBLIC_TOKEN_HEADERS,
    });
  }

  return NextResponse.json(
    {
      auditId: result.auditId,
      statusUrl: result.statusUrl,
      retryAttempt: result.retryAttempt,
    },
    { status: 202, headers: PUBLIC_TOKEN_HEADERS },
  );
}
