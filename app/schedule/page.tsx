import { resolveScheduleExpiredView } from "@/lib/booking/schedule-expired";
import { ScheduleExpiredScreen } from "./expired-screen";

export const dynamic = "force-dynamic";

/**
 * Customer-facing fallback when a findings-call booking session is
 * missing, expired (`expires_at`), or already consumed (`consumed_at`).
 * Successful handoff never lands here — those requests 302 to Google
 * Calendar. The status token is forwarded as `?token=` so we can still
 * offer the original report when `loadAuditResults` resolves it.
 */
export default async function ScheduleUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" ? params.token : params.token?.[0];
  const view = await resolveScheduleExpiredView(token);

  return <ScheduleExpiredScreen view={view} />;
}
