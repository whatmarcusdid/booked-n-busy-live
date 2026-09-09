import { notFound } from "next/navigation";
import { BookFindingsCall } from "@/app/book-findings-call";
import { getAuditStatus } from "@/lib/services/audit-status-service";

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
  const status = await getAuditStatus(token);

  if ("error" in status) notFound();
  if (!status.report) notFound();

  const { report } = status;

  return (
    <main>
      <section className="card">
        {/* TODO(figma): results layout */}
        <h1>Your website diagnostic</h1>
        <p>{status.businessName}</p>
        <p>{status.websiteUrl}</p>
        <p>
          Overall:{" "}
          {report.overallScore == null
            ? "not measured"
            : Math.round(report.overallScore * 100)}
        </p>
        {report.pillars?.length ? (
          <ul>
            {report.pillars.map((pillar) => (
              <li key={pillar.key}>
                {pillar.name}:{" "}
                {pillar.score == null
                  ? "not measured"
                  : Math.round(pillar.score * 100)}
              </li>
            ))}
          </ul>
        ) : null}
        {report.topRecommendations?.length ? (
          <ol>
            {report.topRecommendations.map((row) => (
              <li key={`${row.priority}-${row.title}`}>
                <strong>{row.priority}</strong> {row.title} — {row.description}
              </li>
            ))}
          </ol>
        ) : (
          <p>No major issues found.</p>
        )}
        <BookFindingsCall statusToken={token} />
      </section>
    </main>
  );
}
