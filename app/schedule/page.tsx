import { BOOKING_UNAVAILABLE_MESSAGE } from "@/lib/booking/calendar-handoff";

export const dynamic = "force-dynamic";

/**
 * Customer-facing fallback when a findings-call booking session is
 * missing, expired, or already consumed. Successful handoff never lands
 * here — those requests 302 to Google Calendar.
 */
export default function ScheduleUnavailablePage() {
  return (
    <main>
      <section className="card">
        <h1>Booking unavailable</h1>
        <p>{BOOKING_UNAVAILABLE_MESSAGE}</p>
      </section>
    </main>
  );
}
