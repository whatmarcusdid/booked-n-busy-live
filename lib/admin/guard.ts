import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminAllowList,
  hashAdminEmail,
  readAdminSession,
  type AdminSession,
} from "./auth";

export function sessionFromRequest(request: NextRequest): AdminSession | null {
  return readAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

export function requireAdmin(
  request: NextRequest,
): { session: AdminSession } | { response: NextResponse } {
  const session = sessionFromRequest(request);
  if (!session) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session };
}

export function emailFromHash(emailHash: string): string | null {
  for (const email of adminAllowList()) {
    if (hashAdminEmail(email) === emailHash) return email;
  }
  return null;
}
