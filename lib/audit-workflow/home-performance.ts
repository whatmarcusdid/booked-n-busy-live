import {
  fetchBrowserlessPerformance,
  type FetchPagePerformance,
} from "../browserless";
import { assessUrlSafety, resolveUrlSafely, type UrlSafetyDeps } from "../url-safety";
import type { AuditWorkflowStore } from "./store";
import type { PerformanceSignal } from "./rubric/website-performance";

export const HOME_PERFORMANCE_METADATA_KEY = "performance";

function unavailable(reasonCode: string): PerformanceSignal {
  return { available: false, reason_code: reasonCode };
}

/**
 * Home-page-only Browserless /performance call. A timeout or provider error
 * records not_assessed metadata and does not abort the audit.
 */
export async function captureHomePerformance(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  safetyDeps?: UrlSafetyDeps;
  fetchPerformance?: FetchPagePerformance;
}): Promise<void> {
  const page = await input.store.findPage(input.auditId, "home");
  if (page?.metadata?.assessed === false || page?.metadata?.mock === true) {
    return;
  }
  const targetUrl = page?.url ?? input.websiteUrl;

  const safety = await resolveUrlSafely(targetUrl, input.safetyDeps);
  if (!safety.ok) {
    await record(input, page?.id ?? null, {
      ...unavailable(safety.reasonCode),
      rejected_hop: safety.rejectedHop,
      rejected_url: safety.rejectedUrl,
    });
    return;
  }

  const fetchPerformance = input.fetchPerformance ?? fetchBrowserlessPerformance;
  let result;
  try {
    result = await fetchPerformance({
      url: safety.finalUrl,
      timeoutMs: safety.bounds.maxPerformanceFetchMs,
      maxResponseBytes: safety.bounds.maxResponseBytes,
    });
  } catch {
    await record(input, page?.id ?? null, unavailable("PROVIDER_ERROR"));
    return;
  }

  if (!result.ok) {
    await record(input, page?.id ?? null, unavailable(result.reasonCode));
    return;
  }

  if (result.metrics.finalUrl && result.metrics.finalUrl !== safety.finalUrl) {
    const dest = await assessUrlSafety(result.metrics.finalUrl, input.safetyDeps);
    if (!dest.ok) {
      await record(input, page?.id ?? null, unavailable(dest.reasonCode));
      return;
    }
  }

  await record(input, page?.id ?? null, {
    available: true,
    score: result.metrics.score,
    lcp_ms: result.metrics.lcpMs,
    tbt_ms: result.metrics.tbtMs,
    cls: result.metrics.cls,
  });
}

async function record(
  input: { store: AuditWorkflowStore; auditId: string },
  pageId: string | null,
  signal: PerformanceSignal,
): Promise<void> {
  if (!pageId) return;
  await input.store.mergePageMetadata(input.auditId, pageId, {
    [HOME_PERFORMANCE_METADATA_KEY]: signal,
  });
}