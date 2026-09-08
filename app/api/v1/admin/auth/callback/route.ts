import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  sessionCookieOptions,
  signAdminSession,
} from "@/lib/admin/auth";
import { emailFromHash } from "@/lib/admin/guard";
import { consumeAdminMagicLink, createSupabaseAdminStore } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const consumed = await consumeAdminMagicLink(token, createSupabaseAdminStore());
  const email = consumed ? emailFromHash(consumed.emailHash) : null;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expires = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    signAdminSession({ email, exp: expires.getTime() }),
    sessionCookieOptions(expires),
  );
  return response;
}
