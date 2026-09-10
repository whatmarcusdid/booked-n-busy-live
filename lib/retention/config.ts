export const DEFAULT_RETENTION_ARTIFACT_DAYS = 90;
export const DEFAULT_RETENTION_DATA_DAYS = 365;

export const RETENTION_ARTIFACT_DAYS_ENV = "RETENTION_ARTIFACT_DAYS";
export const RETENTION_DATA_DAYS_ENV = "RETENTION_DATA_DAYS";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a retention window in days. Unset / blank / invalid values fall back
 * to the PRD default. Zero is allowed so tests can expire every seeded row.
 */
export function parseRetentionDays(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function retentionArtifactDays(
  raw: string | undefined = process.env[RETENTION_ARTIFACT_DAYS_ENV],
): number {
  return parseRetentionDays(raw, DEFAULT_RETENTION_ARTIFACT_DAYS);
}

export function retentionDataDays(
  raw: string | undefined = process.env[RETENTION_DATA_DAYS_ENV],
): number {
  return parseRetentionDays(raw, DEFAULT_RETENTION_DATA_DAYS);
}

export function cutoffFromDays(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}
