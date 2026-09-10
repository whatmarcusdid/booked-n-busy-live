import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createResendProvider } from "@/lib/email/resend";
import { resolveAuditBudget } from "@/lib/audit-workflow/pipeline";
import { createSupabaseAuditStore } from "@/lib/audit-workflow/store";
import { EMAIL_NOT_AVAILABLE, requestReportEmail } from "@/lib/email/service";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "report-email"),
    10,
    60_000,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...PUBLIC_TOKEN_HEADERS, "Retry-After": "60" } },
    );
  }

  const { token } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(EMAIL_NOT_AVAILABLE, {
      status: 404,
      headers: PUBLIC_TOKEN_HEADERS,
    });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !token) {
    return NextResponse.json(EMAIL_NOT_AVAILABLE, {
      status: 404,
      headers: PUBLIC_TOKEN_HEADERS,
    });
  }

  const result = await requestReportEmail({
    statusToken: token,
    email: parsed.data.email,
    provider: createResendProvider(),
    budgetFor: (auditId) =>
      resolveAuditBudget(createSupabaseAuditStore(), auditId),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 404, headers: PUBLIC_TOKEN_HEADERS },
    );
  }

  return NextResponse.json(
    {
      deliveryId: result.deliveryId,
      status: result.status,
      duplicate: result.duplicate,
    },
    { status: 202, headers: PUBLIC_TOKEN_HEADERS },
  );
}
