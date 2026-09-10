import { createAdminClient } from "../supabase/admin";
import { URL_SAFETY_BOUNDS } from "../url-safety";

export const AUDIT_ARTIFACTS_BUCKET = {
  id: "audit-artifacts",
  name: "audit-artifacts",
  public: false,
  fileSizeLimit: URL_SAFETY_BOUNDS.maxResponseBytes,
  allowedMimeTypes: ["image/png"] as const,
} as const;

export function assertAuditArtifactsBucketPrivate(
  bucket: { public: boolean } = AUDIT_ARTIFACTS_BUCKET,
): void {
  if (bucket.public !== false) {
    throw new Error("audit-artifacts bucket must be private");
  }
}

export type ArtifactUploadResult =
  | { ok: true }
  | { ok: false; reasonCode: "STORAGE_ERROR" };

export interface ArtifactStorage {
  upload(input: {
    key: string;
    body: Buffer;
    mimeType: string;
  }): Promise<ArtifactUploadResult>;
}

export function createSupabaseArtifactStorage(): ArtifactStorage {
  assertAuditArtifactsBucketPrivate();

  return {
    async upload({ key, body, mimeType }) {
      if (process.env.JEST_WORKER_ID) {
        return { ok: false, reasonCode: "STORAGE_ERROR" };
      }

      const supabase = createAdminClient();
      const { error } = await supabase.storage
        .from(AUDIT_ARTIFACTS_BUCKET.id)
        .upload(key, body, {
          contentType: mimeType,
          upsert: false,
        });

      if (error) {
        return { ok: false, reasonCode: "STORAGE_ERROR" };
      }
      return { ok: true };
    },
  };
}

export function homeScreenshotStorageKey(
  auditId: string,
  viewport: "desktop" | "mobile" = "desktop",
): string {
  return `audits/${auditId}/home/${viewport}.png`;
}

export function pageScreenshotStorageKey(
  auditId: string,
  pageType: string,
  viewport: "desktop" | "mobile" = "desktop",
): string {
  return `audits/${auditId}/${pageType}/${viewport}.png`;
}
