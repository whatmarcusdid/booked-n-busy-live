"use client";

import {
  SCHEDULE_EXPIRED_ERROR_BODY,
  SCHEDULE_EXPIRED_ERROR_HEADLINE,
} from "@/lib/copy/schedule-expired";
import "./schedule-expired.css";

export default function ScheduleError() {
  return (
    <main className="schedule-expired">
      <div className="schedule-expired-content">
        <section className="schedule-expired-hero">
          <h1 className="schedule-expired-headline">
            {SCHEDULE_EXPIRED_ERROR_HEADLINE}
          </h1>
          <p className="schedule-expired-body">{SCHEDULE_EXPIRED_ERROR_BODY}</p>
        </section>
      </div>
    </main>
  );
}
