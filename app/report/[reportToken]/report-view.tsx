"use client";

import { useEffect, useState } from "react";
import type { PublicReport } from "@/lib/reports/public-report";

export function ReportView({ reportToken }: { reportToken: string }) {
  const [report, setReport] = useState<PublicReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/v1/reports/${reportToken}`);
      const json = (await response.json()) as PublicReport & { error?: string };
      if (cancelled) return;
      if (!response.ok) {
        setError(json.error ?? "Report not available");
        return;
      }
      setReport(json);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reportToken]);

  if (error) return <p role="alert">{error}</p>;
  if (!report) return <p>Loading…</p>;

  return (
    <article>
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
      <p>
        <a href="/schedule">Schedule a walkthrough</a>
      </p>
    </article>
  );
}
