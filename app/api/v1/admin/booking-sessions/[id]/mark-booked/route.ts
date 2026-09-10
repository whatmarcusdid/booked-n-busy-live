import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import {
  createSupabaseBookingLinkageStore,
  markBookingSessionBooked,
} from "@/lib/booking/linkage";

/**
 * Manual stand-in for Google Calendar reconciliation.
 *
 * Creates a `meetings` row linked to the same audit/lead as the booking
 * session, with status `booked` and no google_event_id, then consumes the
 * session. Not customer-facing.
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

  try {
    const result = await markBookingSessionBooked(
      id,
      createSupabaseBookingLinkageStore(),
    );

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (result.reason === "expired") {
        return NextResponse.json(
          { error: "Booking session expired" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Booking session already consumed" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        meetingId: result.meeting.id,
        bookingSessionId: result.session.id,
        auditId: result.meeting.auditId,
        leadId: result.meeting.leadId,
        status: result.meeting.status,
        googleEventId: result.meeting.googleEventId,
        scheduledStart: result.meeting.scheduledStart,
        scheduledEnd: result.meeting.scheduledEnd,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to mark booking session booked:", error);
    return NextResponse.json(
      { error: "Could not mark booking session booked" },
      { status: 500 },
    );
  }
}
