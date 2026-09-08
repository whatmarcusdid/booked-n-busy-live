import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashAdminEmail } from "@/lib/admin/auth";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminStore } from "@/lib/admin/service";
import { assembledReportSchema } from "@/lib/reports/schema";
import { validateReportForPublication } from "@/lib/reports/publication";

const bodySchema = z.object({
  assembled: assembledReportSchema,
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
    return NextResponse.json({ error: "Invalid revision" }, { status: 400 });
  }
  const validation = validateReportForPublication(parsed.data.assembled);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
  }

  const store = createSupabaseAdminStore();
  const current = await store.currentRevisionNumber(id);
  if (
    parsed.data.expectedRevisionNumber != null &&
    parsed.data.expectedRevisionNumber !== current
  ) {
    return NextResponse.json({ error: "Revision conflict" }, { status: 409 });
  }

  const revisionId = await store.insertRevision({
    auditId: id,
    revisionNumber: (current ?? 0) + 1,
    assembled: parsed.data.assembled,
    executiveSummary: parsed.data.assembled.executiveSummary,
    overallScore: parsed.data.assembled.overallScore,
  });
  await store.recordEvent(id, "admin_revision_created", {
    revision_id: revisionId,
    reviewer_email_hash: hashAdminEmail(auth.session.email),
  });
  return NextResponse.json({ revisionId }, { status: 201 });
}
