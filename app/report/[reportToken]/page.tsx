import { ReportView } from "./report-view";

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ reportToken: string }>;
}) {
  const { reportToken } = await params;
  return (
    <main>
      <section className="card">
        {/* TODO(figma): full report layout — pillars, recs, typography */}
        <h1>Website diagnostic</h1>
        <ReportView reportToken={reportToken} />
      </section>
    </main>
  );
}
