import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PrepareScreen } from "@/app/audit/prepare/[token]/prepare-screen";
import { findingDiscussionOptions } from "@/lib/copy/pre-call";
import { REPORT_ACCESS_COOKIE } from "@/lib/reports/access-cookie";
import { loadPrepareFromReportCookie } from "@/lib/pre-call/report-prepare";
import "@/app/audit/prepare/[token]/pre-call.css";

export const dynamic = "force-dynamic";

/**
 * Cookie-authenticated Prepare. Same screen as /audit/prepare/[token],
 * authorized by bnb_report_access (Path=/report) instead of a status token.
 */
export default async function ReportPreparePage() {
  const store = await cookies();
  const loaded = await loadPrepareFromReportCookie(
    store.get(REPORT_ACCESS_COOKIE)?.value,
  );

  if (!loaded.ok) redirect("/report");

  return (
    <PrepareScreen
      websiteHost={loaded.view.websiteHost}
      findingOptions={findingDiscussionOptions(
        loaded.view.overallRecommendations,
      )}
      homeHref="/report"
      submitUrl="/report/prepare/answers"
    />
  );
}
