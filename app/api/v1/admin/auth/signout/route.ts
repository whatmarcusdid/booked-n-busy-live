import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/admin/auth";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    "",
    sessionCookieOptions(new Date(0)),
  );
  return response;
}
