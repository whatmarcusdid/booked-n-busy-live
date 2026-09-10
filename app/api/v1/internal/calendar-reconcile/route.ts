import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { redactGoogleSecrets } from "@/lib/calendar/client";
import {
  reconcileCalendar,
  type ReconcileAction,
} from "@/lib/calendar/reconcile";

/**
 * Manual Calendar reconciliation. Admin-only, no cron. Fetches events
 * updated in the lookback window and matches them to pending booking
 * sessions. Does not write Calendar data.
 */
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;

  let lookbackMs: number | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      lookbackMinutes?: unknown;
    };
    if (
      typeof body.lookbackMinutes === "number" &&
      Number.isFinite(body.lookbackMinutes) &&
      body.lookbackMinutes > 0
    ) {
      lookbackMs = Math.min(body.lookbackMinutes, 7 * 24 * 60) * 60_000;
    }
  } catch {
    lookbackMs = undefined;
  }

  try {
    const result = await reconcileCalendar({ lookbackMs });
    if (!result.ok) {
      const status =
        result.reason === "not_configured"
          ? 503
          : result.reason === "unauthorized"
            ? 502
            : 502;
      return NextResponse.json(
        {
          error:
            result.reason === "not_configured"
              ? "Calendar is not configured"
              : result.reason === "unauthorized"
                ? "Calendar authorization failed"
                : "Calendar provider error",
        },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      strategy: result.strategy,
      windowStart: result.windowStart,
      eventsFetched: result.eventsFetched,
      matched: result.actions
        .filter(
          (action): action is Extract<ReconcileAction, { kind: "created" | "updated" }> =>
            action.kind === "created" || action.kind === "updated",
        )
        .map((action) => ({
          action: action.kind,
          meetingId: action.meeting.id,
          bookingSessionId: action.bookingSessionId,
          googleEventId: action.googleEventId,
          status: action.meeting.status,
        })),
      unmatched: result.actions
        .filter(
          (action): action is Extract<ReconcileAction, { kind: "unmatched" }> =>
            action.kind === "unmatched",
        )
        .map((action) => ({
          googleEventId: action.googleEventId,
          reason: action.reason,
        })),
      ambiguous: result.actions
        .filter(
          (action): action is Extract<ReconcileAction, { kind: "ambiguous" }> =>
            action.kind === "ambiguous",
        )
        .map((action) => ({
          googleEventId: action.googleEventId,
          bookingSessionIds: action.bookingSessionIds,
        })),
    });
  } catch (error) {
    const message = redactGoogleSecrets(
      error instanceof Error ? error.message : "unknown_error",
    );
    console.error("calendar-reconcile failed:", message);
    return NextResponse.json(
      { error: "Could not reconcile calendar" },
      { status: 500 },
    );
  }
}
