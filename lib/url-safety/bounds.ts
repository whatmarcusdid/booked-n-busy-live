export interface UrlSafetyBounds {
  allowedPorts: readonly number[];
  maxRedirects: number;
  maxPagesPerDomain: number;
  maxFetchDurationMs: number;
  /** Lighthouse-style /performance is slower than /content or /screenshot. */
  maxPerformanceFetchMs: number;
  maxResponseBytes: number;
}

export const URL_SAFETY_BOUNDS: UrlSafetyBounds = {
  allowedPorts: [80, 443],
  maxRedirects: 5,
  maxPagesPerDomain: 12,
  maxFetchDurationMs: 15_000,
  // Docs: /performance takes seconds-to-minutes; performance-only is typically
  // 20–40s. 60s is 4× the content timeout — enough for a typical home audit
  // without blocking the pipeline for multiple minutes.
  maxPerformanceFetchMs: 60_000,
  maxResponseBytes: 5_000_000,
};
