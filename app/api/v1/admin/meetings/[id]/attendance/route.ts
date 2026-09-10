import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import {
  createSupabaseMeetingAttendanceStore,
  isAttendanceStatus,
  recordMeetingAttendance,
} from "@/lib/booking/attendance";

const bodySchema = z.object({
  status: z.enum(["attended", "no_show"]),
});

/**
 * Admin attendance update for a findings-call meeting.
 *
 * Only booked or rescheduled meetings can move to attended / no_show.
 * Cancelled meetings are rejected.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isAttendanceStatus(parsed.data.status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await recordMeetingAttendance(
      id,
      parsed.data.status,
      createSupabaseMeetingAttendanceStore(),
    );

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (result.reason === "cancelled") {
        return NextResponse.json(
          { error: "Cancelled meetings cannot be marked attended or no-show" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Meeting cannot be marked attended or no-show" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      meetingId: result.meeting.id,
      bookingSessionId: result.meeting.bookingSessionId,
      auditId: result.meeting.auditId,
      leadId: result.meeting.leadId,
      status: result.meeting.status,
    });
  } catch (error) {
    console.error("Failed to record meeting attendance:", error);
    return NextResponse.json(
      { error: "Could not record attendance" },
      { status: 500 },
    );
  }
}
