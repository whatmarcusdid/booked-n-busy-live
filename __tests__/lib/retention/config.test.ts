import {
  DEFAULT_RETENTION_ARTIFACT_DAYS,
  DEFAULT_RETENTION_DATA_DAYS,
  cutoffFromDays,
  parseRetentionDays,
  retentionArtifactDays,
  retentionDataDays,
} from "@/lib/retention/config";

describe("retention env defaults", () => {
  it("defaults to 90 and 365 days", () => {
    expect(DEFAULT_RETENTION_ARTIFACT_DAYS).toBe(90);
    expect(DEFAULT_RETENTION_DATA_DAYS).toBe(365);
    expect(retentionArtifactDays(undefined)).toBe(90);
    expect(retentionDataDays(undefined)).toBe(365);
    expect(retentionArtifactDays("")).toBe(90);
    expect(retentionDataDays("nope")).toBe(365);
    expect(parseRetentionDays("-1", 90)).toBe(90);
  });

  it("accepts a zero-day override so tests can expire every seeded row", () => {
    expect(retentionArtifactDays("0")).toBe(0);
    expect(retentionDataDays("1")).toBe(1);
  });

  it("computes the cutoff from now minus N days", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    expect(cutoffFromDays(90, now).toISOString()).toBe(
      "2026-06-12T00:00:00.000Z",
    );
    expect(cutoffFromDays(0, now).toISOString()).toBe(now.toISOString());
  });
});
