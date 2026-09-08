import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminStore, publishAdminReport } from "@/lib/admin/service";

const bodySchema = z.object({
  expectedRevisionNumber: z.number().int().optional(),
});

/**
 * The only HTTP entry that calls publishReportRevision().
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const result = await publishAdminReport({
    auditId: id,
    reviewerEmail: auth.session.email,
    expectedRevisionNumber: parsed.success
      ? parsed.data.expectedRevisionNumber
      : undefined,
    store: createSupabaseAdminStore(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    published: true,
    reportToken: result.token,
    expiresAt: result.expiresAt,
  });
}
