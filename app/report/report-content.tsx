import type { PublicReport } from "@/lib/reports/public-report";

/**
 * Report body. Rendered server-side from the cookie-authorized report, so
 * there is no longer a client fetch that needs the raw token.
 */
export function ReportContent({ report }: { report: PublicReport }) {
  return (
    <article>
      {/* TODO(figma): report layout */}
      <p>{report.businessName}</p>
      <p>{report.websiteUrl}</p>
      <p>{report.executiveSummary}</p>
      <p>
        Overall:{" "}
        {report.overallScore == null
          ? "not measured"
          : Math.round(report.overallScore * 100)}
      </p>
      <ul>
        {report.pillars.map((pillar) => (
          <li key={pillar.key}>
            {pillar.name}:{" "}
            {pillar.measured && pillar.score != null
              ? Math.round(pillar.score * 100)
              : "not measured"}
          </li>
        ))}
      </ul>
      {report.recommendations.length === 0 ? (
        <p>No major issues found.</p>
      ) : (
        <ol>
          {report.recommendations.map((row) => (
            <li key={`${row.priority}-${row.title}`}>
              <strong>{row.priority}</strong> {row.title} — {row.description}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
