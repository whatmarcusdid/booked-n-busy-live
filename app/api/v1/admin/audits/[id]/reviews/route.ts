import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashAdminEmail } from "@/lib/admin/auth";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminStore } from "@/lib/admin/service";
import {
  isReasonAcceptable,
  OVERRIDE_REASON_REQUIRED_ERROR,
  REVIEW_DECISION_BY_ACTION,
} from "@/lib/admin/review-history";

const bodySchema = z
  .object({
    decision: z.enum(["approve", "reject", "needs_changes"]),
    note: z.string().optional(),
    expectedRevisionNumber: z.number().int().optional(),
  })
  .superRefine((body, ctx) => {
    // An override is recorded as `reject`, and the decision it overrides is
    // only analysable later if the reason came with it. Enforced here, not
    // just in the console, so a hand-rolled request cannot record a
    // reasonless override.
    if (
      body.decision === REVIEW_DECISION_BY_ACTION.override &&
      !isReasonAcceptable(body.note)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: OVERRIDE_REASON_REQUIRED_ERROR,
      });
    }
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
    // The missing-reason case gets its own message, so a rejected override
    // says what is wrong rather than a generic shape complaint.
    const noteIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "note",
    );
    return NextResponse.json(
      { error: noteIssue?.message ?? "Invalid review" },
      { status: 400 },
    );
  }

  const store = createSupabaseAdminStore();
  const current = await store.currentRevisionNumber(id);
  if (
    parsed.data.expectedRevisionNumber != null &&
    parsed.data.expectedRevisionNumber !== current
  ) {
    return NextResponse.json({ error: "Revision conflict" }, { status: 409 });
  }

  // Stored trimmed, so a padded note cannot masquerade as a reason on the
  // decisions where one is optional.
  const note = parsed.data.note?.trim();
  const reviewId = await store.insertReview({
    auditId: id,
    decision: parsed.data.decision,
    note: note === undefined || note === "" ? null : note,
    reviewerEmailHash: hashAdminEmail(auth.session.email),
  });
  await store.recordEvent(id, "admin_review", {
    review_id: reviewId,
    decision: parsed.data.decision,
    reviewer_email_hash: hashAdminEmail(auth.session.email),
  });
  return NextResponse.json({ reviewId }, { status: 201 });
}
