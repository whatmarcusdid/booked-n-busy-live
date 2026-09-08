import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashAdminEmail } from "@/lib/admin/auth";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminStore } from "@/lib/admin/service";

const bodySchema = z.object({
  decision: z.enum(["approve", "reject", "needs_changes"]),
  note: z.string().optional(),
  expectedRevisionNumber: z.number().int().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid review" }, { status: 400 });
  }

  const store = createSupabaseAdminStore();
  const current = await store.currentRevisionNumber(id);
  if (
    parsed.data.expectedRevisionNumber != null &&
    parsed.data.expectedRevisionNumber !== current
  ) {
    return NextResponse.json({ error: "Revision conflict" }, { status: 409 });
  }

  const reviewId = await store.insertReview({
    auditId: id,
    decision: parsed.data.decision,
    note: parsed.data.note ?? null,
    reviewerEmailHash: hashAdminEmail(auth.session.email),
  });
  await store.recordEvent(id, "admin_review", {
    review_id: reviewId,
    decision: parsed.data.decision,
    reviewer_email_hash: hashAdminEmail(auth.session.email),
  });
  return NextResponse.json({ reviewId }, { status: 201 });
}
