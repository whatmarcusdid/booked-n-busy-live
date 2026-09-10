import { createHash } from "crypto";
import {
  captureBrowserlessScreenshot,
  type CaptureScreenshot,
  type ScreenshotViewportName,
} from "../browserless";
import {
  createSupabaseArtifactStorage,
  pageScreenshotStorageKey,
  type ArtifactStorage,
} from "../storage/audit-artifacts";
import { assessUrlSafety, resolveUrlSafely, type UrlSafetyDeps } from "../url-safety";
import type { AuditWorkflowStore } from "./store";

export const SCREENSHOT_RETENTION_CLASS = "pending_policy";

export function screenshotEvidenceKey(
  pageType: string,
  viewport: ScreenshotViewportName,
): string {
  if (pageType === "home" && viewport === "desktop") {
    return "homepage_screenshot";
  }
  if (pageType === "home" && viewport === "mobile") {
    return "homepage_screenshot_mobile";
  }
  return viewport === "mobile"
    ? `${pageType}_screenshot_mobile`
    : `${pageType}_screenshot`;
}

function metadataKey(
  viewport: ScreenshotViewportName,
): "screenshot" | "screenshot_mobile" {
  return viewport === "mobile" ? "screenshot_mobile" : "screenshot";
}

export async function captureAndStorePageScreenshots(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  pageType: string;
  viewports: readonly ScreenshotViewportName[];
  safetyDeps?: UrlSafetyDeps;
  captureScreenshot?: CaptureScreenshot;
  artifactStorage?: ArtifactStorage;
}): Promise<void> {
  const page = await input.store.findPage(input.auditId, input.pageType);
  if (page?.metadata?.assessed === false || page?.metadata?.mock === true) {
    return;
  }
  const screenshotUrl = page?.url ?? input.websiteUrl;

  for (const viewport of input.viewports) {
    await captureOneViewport({
      store: input.store,
      auditId: input.auditId,
      safetyDeps: input.safetyDeps,
      captureScreenshot: input.captureScreenshot,
      artifactStorage: input.artifactStorage,
      pageId: page?.id ?? null,
      pageType: input.pageType,
      screenshotUrl,
      viewport,
    });
  }
}

async function captureOneViewport(input: {
  store: AuditWorkflowStore;
  auditId: string;
  safetyDeps?: UrlSafetyDeps;
  captureScreenshot?: CaptureScreenshot;
  artifactStorage?: ArtifactStorage;
  pageId: string | null;
  pageType: string;
  screenshotUrl: string;
  viewport: ScreenshotViewportName;
}): Promise<void> {
  const evidenceKey = screenshotEvidenceKey(input.pageType, input.viewport);
  const existing = await input.store.hasEvidence(input.auditId, evidenceKey);
  if (existing) return;

  const safety = await resolveUrlSafely(input.screenshotUrl, input.safetyDeps);
  if (!safety.ok) {
    await recordUnavailable(input, evidenceKey, safety.reasonCode, {
      rejectedHop: safety.rejectedHop,
      rejectedUrl: safety.rejectedUrl,
    });
    return;
  }

  const capture = input.captureScreenshot ?? captureBrowserlessScreenshot;
  const shot = await capture({
    url: safety.finalUrl,
    timeoutMs: safety.bounds.maxFetchDurationMs,
    maxResponseBytes: safety.bounds.maxResponseBytes,
    viewport: input.viewport,
  });

  if (!shot.ok) {
    await recordUnavailable(input, evidenceKey, shot.reasonCode);
    return;
  }

  if (shot.redirected || shot.finalUrl !== safety.finalUrl) {
    const dest = await assessUrlSafety(shot.finalUrl, input.safetyDeps);
    if (!dest.ok) {
      await recordUnavailable(input, evidenceKey, dest.reasonCode);
      return;
    }
  }

  const storage = input.artifactStorage ?? createSupabaseArtifactStorage();
  const storageKey = pageScreenshotStorageKey(
    input.auditId,
    input.pageType,
    input.viewport,
  );
  const uploaded = await storage.upload({
    key: storageKey,
    body: shot.bytes,
    mimeType: shot.mimeType,
  });

  if (!uploaded.ok) {
    await recordUnavailable(input, evidenceKey, uploaded.reasonCode);
    return;
  }

  const checksum = createHash("sha256").update(shot.bytes).digest("hex");
  const artifactId = await input.store.insertArtifact({
    audit_id: input.auditId,
    audit_page_id: input.pageId,
    storage_key: storageKey,
    mime_type: shot.mimeType,
    size: shot.bytes.byteLength,
    checksum,
    viewport: input.viewport,
    retention_class: SCREENSHOT_RETENTION_CLASS,
  });

  if (input.pageId) {
    await input.store.mergePageMetadata(input.auditId, input.pageId, {
      [metadataKey(input.viewport)]: {
        available: true,
        artifact_id: artifactId,
        viewport: input.viewport,
      },
    });
  }

  await input.store.upsertEvidence(input.auditId, [
    {
      mock_key: evidenceKey,
      evidence_type: "screenshot",
      description:
        input.viewport === "mobile"
          ? `${input.pageType} mobile screenshot`
          : `${input.pageType} screenshot`,
      artifact_id: artifactId,
      metadata: {
        page: input.pageType,
        mock: false,
        screenshot_available: true,
        viewport: input.viewport,
      },
    },
  ]);
}

async function recordUnavailable(
  input: {
    store: AuditWorkflowStore;
    auditId: string;
    pageId: string | null;
    viewport: ScreenshotViewportName;
    pageType: string;
  },
  evidenceKey: string,
  reasonCode: string,
  rejection?: { rejectedHop: number; rejectedUrl: string },
): Promise<void> {
  if (input.pageId) {
    await input.store.mergePageMetadata(input.auditId, input.pageId, {
      [metadataKey(input.viewport)]: {
        available: false,
        artifact_id: null,
        reason_code: reasonCode,
        viewport: input.viewport,
        ...(rejection
          ? {
              rejected_hop: rejection.rejectedHop,
              rejected_url: rejection.rejectedUrl,
            }
          : {}),
      },
    });
  }

  await input.store.upsertEvidence(input.auditId, [
    {
      mock_key: evidenceKey,
      evidence_type: "screenshot",
      description:
        input.viewport === "mobile"
          ? `${input.pageType} mobile screenshot`
          : `${input.pageType} screenshot`,
      artifact_id: null,
      metadata: {
        page: input.pageType,
        mock: false,
        screenshot_available: false,
        reason_code: reasonCode,
        viewport: input.viewport,
        ...(rejection
          ? {
              rejected_hop: rejection.rejectedHop,
              rejected_url: rejection.rejectedUrl,
            }
          : {}),
      },
    },
  ]);
}
