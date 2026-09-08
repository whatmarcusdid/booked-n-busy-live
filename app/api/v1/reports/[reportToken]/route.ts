import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import {
  getPublicReport,
  REPORT_NOT_AVAILABLE_BODY,
  REPORT_NOT_AVAILABLE_STATUS,
} from "@/lib/reports/public-report";

const REPORT_RATE_LIMIT = 30;
const REPORT_RATE_WINDOW_MS = 60_000;

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...PUBLIC_TOKEN_HEADERS, ...extra },
  });
}

function notAvailable(): NextResponse {
  return json(REPORT_NOT_AVAILABLE_BODY, REPORT_NOT_AVAILABLE_STATUS);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reportToken: string }> },
) {
  try {
    const limit = consumeRateLimit(
      clientKeyFromRequest(request.headers, "public-report"),
      REPORT_RATE_LIMIT,
      REPORT_RATE_WINDOW_MS,
    );
    if (!limit.ok) {
      return json(
        { error: "Too many requests" },
        429,
        { "Retry-After": "60" },
      );
    }

    const { reportToken } = await context.params;
    if (!reportToken) {
      return notAvailable();
    }

    const result = await getPublicReport(reportToken);
    if (!result.ok) {
      return notAvailable();
    }

    return json(result.report, 200);
  } catch (error) {
    console.error("Unexpected error in public report endpoint:", error);
    return notAvailable();
  }
}
