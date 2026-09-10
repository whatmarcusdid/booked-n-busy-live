import { notFound } from "next/navigation";
import { pillarDefinitionBySlug } from "@/lib/copy/audit-results";
import { loadAuditResults } from "@/lib/services/audit-results-service";
import { ResultsScreen } from "../results-screen";
import "../audit-results.css";

export const dynamic = "force-dynamic";

export default async function AuditResultsPillarPage({
  params,
}: {
  params: Promise<{ token: string; pillar: string }>;
}) {
  const { token, pillar: slug } = await params;
  const definition = pillarDefinitionBySlug(slug);
  if (!definition) notFound();

  const loaded = await loadAuditResults(token);
  if (!loaded.ok) notFound();

  return (
    <ResultsScreen
      token={token}
      mode="detail"
      pillarKey={definition.key}
      view={loaded.view}
    />
  );
}
