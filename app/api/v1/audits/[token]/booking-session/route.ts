import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import {
  createBookingSessionForAudit,
  createSupabaseBookingLinkageStore,
} from "@/lib/booking/linkage";

/**
 * Admin-only create for the findings-call linkage model.
 *
 * Lives under `/api/v1/audits/[token]/` because that dynamic segment already
 * exists (status-token email/retry). This subroute treats the segment as an
 * audit UUID, not a public status token, and requires an admin session.
 *
 * The customer CTA is unchanged: `POST /api/v1/booking-sessions`.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;

  const { token: auditId } = await context.params;
  if (!auditId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await createBookingSessionForAudit(
      auditId,
      createSupabaseBookingLinkageStore(),
    );

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (result.reason === "ineligible") {
        return NextResponse.json(
          {
            error: "Audit is not eligible for a findings call",
            currentState: result.currentState,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Lead has no plaintext email" },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        bookingSessionId: result.session.id,
        auditId: result.session.auditId,
        leadId: result.session.leadId,
        customerEmail: result.session.customerEmail,
        expiresAt: result.session.expiresAt,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    console.error("Failed to create booking session:", error);
    return NextResponse.json(
      { error: "Could not create booking session" },
      { status: 500 },
    );
  }
}
