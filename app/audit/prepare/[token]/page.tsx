import { notFound } from "next/navigation";
import { findingDiscussionOptions } from "@/lib/copy/pre-call";
import { loadAuditResults } from "@/lib/services/audit-results-service";
import { PrepareScreen } from "./prepare-screen";
import "./pre-call.css";

export const dynamic = "force-dynamic";

/**
 * Optional three-question form before the findings-call scheduler.
 *
 * Authorized by the same public status token as the live results screen.
 * Submitting writes `pre_call_answers` and continues to the Calendar
 * handoff. Skipping writes nothing and goes to the same handoff.
 */
export default async function PreparePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const loaded = await loadAuditResults(token);

  if (!loaded.ok) notFound();

  return (
    <PrepareScreen
      token={token}
      websiteHost={loaded.view.websiteHost}
      findingOptions={findingDiscussionOptions(
        loaded.view.overallRecommendations,
      )}
    />
  );
}
