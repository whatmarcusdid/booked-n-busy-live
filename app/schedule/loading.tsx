import { SCHEDULE_EXPIRED_LOADING_LABEL } from "@/lib/copy/schedule-expired";
import { ScheduleExpiredLogo } from "./expired-screen";
import "./schedule-expired.css";

export default function ScheduleLoading() {
  return (
    <main className="schedule-expired" aria-busy="true">
      <nav className="schedule-expired-nav" aria-label="Primary">
        <ScheduleExpiredLogo />
      </nav>
      <div className="schedule-expired-content">
        <p className="schedule-expired-body">
          {SCHEDULE_EXPIRED_LOADING_LABEL}
        </p>
      </div>
    </main>
  );
}
