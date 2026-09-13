import Link from "next/link";
import { BRAND_NAME, SUPPORT_EMAIL } from "@/lib/identity";
import type { ScheduleExpiredView } from "@/lib/booking/schedule-expired";
import {
  BACK_TO_REPORT_LABEL,
  SCHEDULE_CONSUMED_BODY,
  SCHEDULE_CONSUMED_HEADLINE,
  SCHEDULE_EXPIRED_BODY_WITH_REPORT,
  SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT,
  SCHEDULE_EXPIRED_ERROR_BODY,
  SCHEDULE_EXPIRED_ERROR_HEADLINE,
  SCHEDULE_EXPIRED_HEADLINE,
  supportConsumedRebookLabel,
  supportRebookLabel,
} from "@/lib/copy/schedule-expired";
import "./schedule-expired.css";

export function ScheduleExpiredLogo() {
  return (
    <Link className="schedule-expired-logo" href="/">
      <span className="schedule-expired-logo-mark">
        <img src="/audit/logo-mark.svg" alt="" width={51} height={51} />
      </span>
      <span className="schedule-expired-wordmark">
        <img src="/audit/wordmark.svg" alt={BRAND_NAME} width={94} height={51} />
      </span>
    </Link>
  );
}

function Icon() {
  return (
    <span className="schedule-expired-icon" aria-hidden="true">
      <img
        src="/schedule/schedule-icon.svg"
        alt=""
        width={56}
        height={56}
      />
    </span>
  );
}

export function ScheduleExpiredScreen({
  view,
}: {
  view: ScheduleExpiredView;
}) {
  const isError = view.kind === "error";

  return (
    <main className="schedule-expired">
      <nav className="schedule-expired-nav" aria-label="Primary">
        <ScheduleExpiredLogo />
      </nav>
      <div className="schedule-expired-content">
        <section className="schedule-expired-hero">
          <Icon />
          <h1 className="schedule-expired-headline">
            {isError
              ? SCHEDULE_EXPIRED_ERROR_HEADLINE
              : view.kind === "booked"
                ? SCHEDULE_CONSUMED_HEADLINE
                : SCHEDULE_EXPIRED_HEADLINE}
          </h1>
          {view.kind === "report" ? (
            <>
              <p className="schedule-expired-body">
                {SCHEDULE_EXPIRED_BODY_WITH_REPORT}
              </p>
              <Link className="schedule-expired-cta" href={view.reportHref}>
                {BACK_TO_REPORT_LABEL}
              </Link>
            </>
          ) : view.kind === "booked" ? (
            <>
              <p className="schedule-expired-body">
                {SCHEDULE_CONSUMED_BODY}
              </p>
              <a
                className="schedule-expired-support"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {supportConsumedRebookLabel(SUPPORT_EMAIL)}
              </a>
            </>
          ) : view.kind === "support" ? (
            <>
              <p className="schedule-expired-body">
                {SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT}
              </p>
              <a
                className="schedule-expired-support"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {supportRebookLabel(SUPPORT_EMAIL)}
              </a>
            </>
          ) : (
            <p className="schedule-expired-body">
              {SCHEDULE_EXPIRED_ERROR_BODY}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
