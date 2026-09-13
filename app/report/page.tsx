import { cookies } from "next/headers";
import {
  findAuditIdByReportTokenHash,
  loadFindingsCallBooked,
} from "@/lib/booking/findings-call-booked";
import { resolveCookieReportAccess } from "@/lib/reports/access";
import {
  REPORT_ACCESS_COOKIE,
  readReportAccess,
} from "@/lib/reports/access-cookie";
import { BookFindingsCall } from "../book-findings-call";
import { FindingsCallBooked } from "../findings-call-booked";
import { ExpiredReportRequest } from "./expired-report-request";
import { ReportContent } from "./report-content";

export const dynamic = "force-dynamic";

/**
 * The clean report URL. Reached by redirect from /report/{token} once the
 * token has been exchanged for a cookie, so the raw token never appears here.
 */
export default async function ReportPage() {
  const store = await cookies();
  const claim = readReportAccess(store.get(REPORT_ACCESS_COOKIE)?.value);

  if (!claim) {
    return (
      <main>
        <section className="card">
          <h1>Report not available</h1>
          <p>
            Open the link from your report email to view your results. If the
            link is old, request a new one below.
          </p>
          <ExpiredReportRequest />
        </section>
      </main>
    );
  }

  // Re-resolved on every view rather than trusted from the cookie, so a
  // report that expires or is revoked mid-session stops being readable.
  const access = await resolveCookieReportAccess(claim.tokenHash);

  if (access.outcome === "expired") {
    return (
      <main>
        <section className="card">
          <h1>This report has expired</h1>
          {access.retained ? (
            <p>
              Your results are still on file. Enter your email and we&apos;ll
              send you a fresh link.
            </p>
          ) : (
            <p>
              Your results are no longer on file. Enter your email and
              we&apos;ll run a new scan of your site.
            </p>
          )}
          <ExpiredReportRequest retained={access.retained} />
        </section>
      </main>
    );
  }

  if (access.outcome === "unavailable") {
    return (
      <main>
        <section className="card">
          <h1>Report not available</h1>
          <p>Open the link from your report email to view your results.</p>
        </section>
      </main>
    );
  }

  const auditId = await findAuditIdByReportTokenHash(access.tokenHash);
  const bookedView = auditId
    ? await loadFindingsCallBooked(auditId)
    : null;

  return (
    <main>
      <section className="card">
        <h1>Your website diagnostic</h1>
        <ReportContent report={access.report} />
        {bookedView ? (
          <FindingsCallBooked view={bookedView} />
        ) : (
          <BookFindingsCall />
        )}
      </section>
    </main>
  );
}
