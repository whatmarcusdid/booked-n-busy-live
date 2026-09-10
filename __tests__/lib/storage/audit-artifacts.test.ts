import { readFileSync } from "fs";
import { resolve } from "path";
import {
  AUDIT_ARTIFACTS_BUCKET,
  assertAuditArtifactsBucketPrivate,
} from "@/lib/storage/audit-artifacts";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260908120000_audit_artifacts.sql",
);

describe("audit-artifacts bucket privacy", () => {
  it("declares the bucket as private in application config", () => {
    expect(AUDIT_ARTIFACTS_BUCKET.public).toBe(false);
    expect(AUDIT_ARTIFACTS_BUCKET.id).toBe("audit-artifacts");
    expect(() => assertAuditArtifactsBucketPrivate()).not.toThrow();
    expect(() =>
      assertAuditArtifactsBucketPrivate({ public: true }),
    ).toThrow(/must be private/);
  });

  it("creates the bucket with public=false in the migration", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("audit-artifacts");
    expect(sql).toMatch(
      /VALUES \(\s*'audit-artifacts',\s*'audit-artifacts',\s*false,/,
    );
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE\s+SET\s+public = false/);
    expect(sql).not.toMatch(/'audit-artifacts'[\s\S]{0,80}true/);
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(
      /ON storage\.objects[\s\S]{0,80}TO (anon|authenticated)/,
    );
  });
});
