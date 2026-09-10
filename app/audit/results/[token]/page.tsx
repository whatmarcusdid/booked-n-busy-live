import { notFound } from "next/navigation";
import { BookFindingsCall } from "@/app/book-findings-call";
import { loadAuditResults } from "@/lib/services/audit-results-service";
import { RequestManualReview } from "./request-manual-review";
import { ResultsScreen } from "./results-screen";
import "./audit-results.css";

export const dynamic = "force-dynamic";

/**
 * Results for the browser that submitted the audit, authorized by the status
 * token it already holds.
 *
 * This is the destination the live session goes to when the audit finishes,
 * including when it finishes after the slow-audit message has appeared. It
 * exists because the shareable report link is keyed by a token that is only
 * minted at publication — a live session can never construct that URL, so
 * without this route the only path to results would be the email.
 */
export default async function AuditResultsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const loaded = await loadAuditResults(token);

  if (!loaded.ok) notFound();

  const { view } = loaded;
  const cta =
    view.auditState === "failed" ? (
      <RequestManualReview token={token} />
    ) : view.auditState === "unsupported" ? undefined : (
      <BookFindingsCall statusToken={token} />
    );

  return <ResultsScreen token={token} mode="hub" view={view} cta={cta} />;
}
