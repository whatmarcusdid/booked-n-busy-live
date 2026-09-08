import { StatusPoller } from "./status-poller";

export default async function AuditStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main>
      <section className="card">
        {/* TODO(figma): processing animation and progress treatment */}
        <h1>Working on your diagnostic</h1>
        <StatusPoller token={token} />
      </section>
    </main>
  );
}
