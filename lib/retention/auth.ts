import { NextRequest } from "next/server";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. There is no other
 * cron endpoint in this repo yet, so this is the convention we introduce.
 * Unset secret refuses every caller — the purge must never be reachable
 * without a configured secret.
 */
export function cronAuthorized(
  request: NextRequest,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}
