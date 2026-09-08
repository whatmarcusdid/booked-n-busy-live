import type { CaptureScreenshot } from "../browserless";
import type { ArtifactStorage } from "../storage/audit-artifacts";
import type { UrlSafetyDeps } from "../url-safety";
import { captureAndStorePageScreenshots } from "./page-screenshot";
import type { AuditWorkflowStore } from "./store";

export const HOME_SCREENSHOT_EVIDENCE_KEY = "homepage_screenshot";
export const HOME_MOBILE_SCREENSHOT_EVIDENCE_KEY =
  "homepage_screenshot_mobile";
export const SCREENSHOT_VIEWPORT = "desktop";
export const SCREENSHOT_RETENTION_CLASS = "pending_policy";

export async function captureAndStoreHomeScreenshot(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  safetyDeps?: UrlSafetyDeps;
  captureScreenshot?: CaptureScreenshot;
  artifactStorage?: ArtifactStorage;
}): Promise<void> {
  await captureAndStorePageScreenshots({
    ...input,
    pageType: "home",
    viewports: ["desktop", "mobile"],
  });
}
