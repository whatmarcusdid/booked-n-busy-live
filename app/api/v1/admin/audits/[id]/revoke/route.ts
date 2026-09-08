import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashAdminEmail } from "@/lib/admin/auth";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminStore } from "@/lib/admin/service";

const bodySchema = z.object({
  expectedRevisionNumber: z.number().int().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const store = createSupabaseAdminStore();
  const result = await store.revoke(
    id,
    parsed.success ? parsed.data.expectedRevisionNumber : undefined,
  );
  if (result !== "updated") {
    return NextResponse.json(
      { error: result === "conflict" ? "Revision conflict" : "Not found" },
      { status: result === "conflict" ? 409 : 404 },
    );
  }
  await store.recordEvent(id, "admin_revoked", {
    reviewer_email_hash: hashAdminEmail(auth.session.email),
  });
  return NextResponse.json({ revoked: true });
}
