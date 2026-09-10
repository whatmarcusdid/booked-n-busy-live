/**
 * Evidence assembly for the per-audit review screen.
 *
 * Two gaps in the existing admin detail endpoint are closed here rather than
 * by changing that endpoint:
 *
 *   1. `getAudit()` returns `evidence` rows, which carry `artifact_id`, but
 *      not the `artifacts` rows themselves — so there is no `storage_key` to
 *      resolve a screenshot with.
 *   2. The `audit-artifacts` bucket is private by assertion, and the artifact
 *      storage module only exposes `upload`. Viewing needs a short-lived
 *      signed URL, which is minted per request and never persisted.
 */
import { createAdminClient } from "../supabase/admin";
import { AUDIT_ARTIFACTS_BUCKET } from "../storage/audit-artifacts";

/** Long enough to review one audit, short enough not to be a shareable link. */
export const SCREENSHOT_URL_TTL_SECONDS = 300;

export interface EvidenceRow {
  id: string;
  evidence_type: string;
  url: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  artifact_id: string | null;
}

export interface ArtifactRow {
  id: string;
  storage_key: string;
  mime_type: string;
  viewport: string;
  audit_page_id: string | null;
}

export interface EvidenceView {
  id: string;
  evidenceType: string;
  /** The extracted snippet or observed value, as recorded. */
  snippet: string | null;
  locator: string | null;
  value: string | null;
  outcome: string | null;
  reasonCode: string | null;
  confidence: number | null;
  collectionMethod: string | null;
  url: string | null;
  artifactId: string | null;
}

export interface ScreenshotView {
  artifactId: string;
  viewport: string;
  storageKey: string;
  /** Null when the signed URL could not be minted; the row still shows. */
  signedUrl: string | null;
}

export interface ReviewEvidence {
  /** Evidence grouped by the criterion it supports, for the check breakdown. */
  byCriterion: Record<string, EvidenceView[]>;
  /** Evidence with no criterion_key, e.g. the raw lighthouse report. */
  unattributed: EvidenceView[];
  screenshots: ScreenshotView[];
  reasonCodes: string[];
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function toEvidenceView(row: EvidenceRow): EvidenceView {
  const metadata = row.metadata ?? {};
  const confidence = metadata.confidence;

  return {
    id: row.id,
    evidenceType: row.evidence_type,
    snippet: row.description ?? null,
    locator: readString(metadata, "locator"),
    value: readString(metadata, "value"),
    outcome: readString(metadata, "outcome"),
    reasonCode:
      readString(metadata, "reason_code") ??
      readString(metadata, "failure_type"),
    confidence: typeof confidence === "number" ? confidence : null,
    collectionMethod: readString(metadata, "collection_method"),
    url: row.url,
    artifactId: row.artifact_id,
  };
}

export function groupEvidenceForReview(
  evidence: EvidenceRow[],
  artifacts: ArtifactRow[],
  signedUrls: Record<string, string | null> = {},
): ReviewEvidence {
  const byCriterion: Record<string, EvidenceView[]> = {};
  const unattributed: EvidenceView[] = [];
  const reasonCodes = new Set<string>();

  for (const row of evidence) {
    const view = toEvidenceView(row);
    if (view.reasonCode) reasonCodes.add(view.reasonCode);

    const criterionKey = readString(row.metadata ?? {}, "criterion_key");
    if (criterionKey) {
      byCriterion[criterionKey] = [...(byCriterion[criterionKey] ?? []), view];
    } else {
      unattributed.push(view);
    }
  }

  const screenshots: ScreenshotView[] = artifacts.map((artifact) => ({
    artifactId: artifact.id,
    viewport: artifact.viewport,
    storageKey: artifact.storage_key,
    signedUrl: signedUrls[artifact.storage_key] ?? null,
  }));

  return {
    byCriterion,
    unattributed,
    screenshots,
    reasonCodes: [...reasonCodes].sort(),
  };
}

export async function loadReviewEvidence(
  auditId: string,
  evidence: EvidenceRow[],
): Promise<ReviewEvidence> {
  const supabase = createAdminClient();

  const { data: artifacts } = await supabase
    .from("artifacts")
    .select("id, storage_key, mime_type, viewport, audit_page_id")
    .eq("audit_id", auditId);

  const rows = (artifacts ?? []) as ArtifactRow[];
  const signedUrls: Record<string, string | null> = {};

  for (const artifact of rows) {
    signedUrls[artifact.storage_key] = await signScreenshot(
      supabase,
      artifact.storage_key,
    );
  }

  return groupEvidenceForReview(evidence, rows, signedUrls);
}

async function signScreenshot(
  supabase: ReturnType<typeof createAdminClient>,
  storageKey: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(AUDIT_ARTIFACTS_BUCKET.id)
    .createSignedUrl(storageKey, SCREENSHOT_URL_TTL_SECONDS);

  if (error || !data) return null;
  return data.signedUrl;
}
