import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ARTIFACTS_JOB,
  INDEFINITE_RETENTION_TABLES,
  STRUCTURED_DATA_TARGETS,
  STRUCTURED_DATA_JOB,
  createSupabaseArtifactObjectStore,
  isBenignStorageError,
  runArtifactPurge,
  runRetentionPurge,
  runStructuredDataPurge,
  type ArtifactObjectStore,
  type ArtifactRow,
  type PurgeRunRecord,
  type RetentionStore,
} from "@/lib/retention/purge";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const OLD = "2025-01-01T00:00:00.000Z";
const RECENT = "2026-09-10T00:00:00.000Z";

interface MemoryRow {
  id: string;
  created_at: string;
  transitioned_at?: string;
}

interface MemoryArtifact extends ArtifactRow {
  created_at: string;
}

function memoryStore(seed: {
  artifacts?: MemoryArtifact[];
  evidence?: MemoryRow[];
  report_revisions?: MemoryRow[];
  audit_state_transitions?: MemoryRow[];
  audit_events?: MemoryRow[];
  criterion_results?: MemoryRow[];
  pillar_results?: MemoryRow[];
  leads?: MemoryRow[];
  meetings?: MemoryRow[];
  admin_reviews?: MemoryRow[];
}) {
  const artifacts = [...(seed.artifacts ?? [])];
  const tables: Record<string, MemoryRow[]> = {
    evidence: [...(seed.evidence ?? [])],
    report_revisions: [...(seed.report_revisions ?? [])],
    audit_state_transitions: [...(seed.audit_state_transitions ?? [])],
    audit_events: [...(seed.audit_events ?? [])],
    criterion_results: [...(seed.criterion_results ?? [])],
    pillar_results: [...(seed.pillar_results ?? [])],
    leads: [...(seed.leads ?? [])],
    meetings: [...(seed.meetings ?? [])],
    admin_reviews: [...(seed.admin_reviews ?? [])],
  };
  const runs: PurgeRunRecord[] = [];

  const store: RetentionStore & {
    artifacts: MemoryArtifact[];
    tables: typeof tables;
    runs: PurgeRunRecord[];
  } = {
    artifacts,
    tables,
    runs,
    async listExpiredArtifacts(cutoff) {
      return artifacts
        .filter((row) => Date.parse(row.created_at) < cutoff.getTime())
        .map(({ id, storage_key }) => ({ id, storage_key }));
    },
    async deleteArtifacts(ids) {
      const remove = new Set(ids);
      let deleted = 0;
      for (let i = artifacts.length - 1; i >= 0; i--) {
        if (remove.has(artifacts[i].id)) {
          artifacts.splice(i, 1);
          deleted++;
        }
      }
      return deleted;
    },
    async deleteOlderThan(table, column, cutoff) {
      const rows = tables[table];
      let deleted = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const stamp =
          column === "transitioned_at"
            ? rows[i].transitioned_at ?? rows[i].created_at
            : rows[i].created_at;
        if (Date.parse(stamp) < cutoff.getTime()) {
          rows.splice(i, 1);
          deleted++;
        }
      }
      return deleted;
    },
    async insertPurgeRun(run) {
      runs.push(run);
    },
  };

  return store;
}

function memoryObjects(
  keys: string[],
  opts: { failKeys?: string[] } = {},
): ArtifactObjectStore & { remaining: Set<string>; removeCalls: string[][] } {
  const remaining = new Set(keys);
  const fail = new Set(opts.failKeys ?? []);
  const removeCalls: string[][] = [];
  return {
    remaining,
    removeCalls,
    async remove(requested) {
      removeCalls.push([...requested]);
      let removed = 0;
      let failed = 0;
      for (const key of requested) {
        if (fail.has(key)) {
          failed++;
          continue;
        }
        remaining.delete(key);
        removed++;
      }
      return { removed, failed };
    },
  };
}

describe("90-day artifact purge", () => {
  it("deletes expired storage objects and artifact rows, and leaves recent ones", async () => {
    const store = memoryStore({
      artifacts: [
        { id: "old", storage_key: "audits/a/home.png", created_at: OLD },
        { id: "new", storage_key: "audits/b/home.png", created_at: RECENT },
      ],
    });
    const objects = memoryObjects(["audits/a/home.png", "audits/b/home.png"]);

    const result = await runArtifactPurge({
      store,
      objects,
      days: 1,
      now: NOW,
    });

    expect(result.status).toBe("success");
    expect(result.rowsDeleted).toBe(1);
    expect(result.objectsDeleted).toBe(1);
    expect(store.artifacts.map((row) => row.id)).toEqual(["new"]);
    expect([...objects.remaining]).toEqual(["audits/b/home.png"]);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      job_name: ARTIFACTS_JOB,
      rows_deleted: 1,
      objects_deleted: 1,
      status: "success",
    });
  });

  it("writes a success run when nothing is eligible", async () => {
    const store = memoryStore({
      artifacts: [
        { id: "new", storage_key: "audits/b/home.png", created_at: RECENT },
      ],
    });
    const objects = memoryObjects(["audits/b/home.png"]);

    const result = await runArtifactPurge({
      store,
      objects,
      days: 1,
      now: NOW,
    });

    expect(result.rowsDeleted).toBe(0);
    expect(result.objectsDeleted).toBe(0);
    expect(store.artifacts).toHaveLength(1);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0].rows_deleted).toBe(0);
    expect(store.runs[0].status).toBe("success");
    expect(objects.removeCalls).toEqual([]);
  });

  it("is safe to run twice: second pass deletes nothing and does not error", async () => {
    const store = memoryStore({
      artifacts: [
        { id: "old", storage_key: "audits/a/home.png", created_at: OLD },
      ],
    });
    const objects = memoryObjects(["audits/a/home.png"]);

    await runArtifactPurge({ store, objects, days: 1, now: NOW });
    const second = await runArtifactPurge({ store, objects, days: 1, now: NOW });

    expect(second.status).toBe("success");
    expect(second.rowsDeleted).toBe(0);
    expect(store.runs).toHaveLength(2);
    expect(store.runs[1].rows_deleted).toBe(0);
    expect(objects.removeCalls).toHaveLength(1);
  });

  it("treats an already-deleted storage object as success", () => {
    expect(isBenignStorageError(new Error("Object not found"))).toBe(true);
    expect(isBenignStorageError({ message: "The resource was not found" })).toBe(
      true,
    );
    expect(isBenignStorageError(new Error("permission denied"))).toBe(false);
  });

  it("does not throw when Storage remove reports a missing object", async () => {
    const client = {
      storage: {
        from() {
          return {
            async remove() {
              return { error: { message: "Object not found" } };
            },
          };
        },
      },
    };
    const objects = createSupabaseArtifactObjectStore(client as never);
    await expect(objects.remove(["already-gone.png"])).resolves.toEqual({
      removed: 1,
      failed: 0,
    });
  });
});

describe("12-month structured-data purge", () => {
  it("deletes expired evidence, revisions, transitions, and events only", async () => {
    const store = memoryStore({
      evidence: [
        { id: "e-old", created_at: OLD },
        { id: "e-new", created_at: RECENT },
      ],
      report_revisions: [
        { id: "r-old", created_at: OLD },
        { id: "r-new", created_at: RECENT },
      ],
      audit_state_transitions: [
        { id: "t-old", created_at: OLD, transitioned_at: OLD },
        { id: "t-new", created_at: RECENT, transitioned_at: RECENT },
      ],
      audit_events: [
        { id: "v-old", created_at: OLD },
        { id: "v-new", created_at: RECENT },
      ],
      criterion_results: [{ id: "c-old", created_at: OLD }],
      pillar_results: [{ id: "p-old", created_at: OLD }],
      leads: [{ id: "lead-old", created_at: OLD }],
      meetings: [{ id: "m-old", created_at: OLD }],
      admin_reviews: [{ id: "ar-old", created_at: OLD }],
    });

    const result = await runStructuredDataPurge({
      store,
      days: 1,
      now: NOW,
    });

    expect(result.status).toBe("success");
    expect(result.rowsDeleted).toBe(4);
    expect(store.tables.evidence.map((row) => row.id)).toEqual(["e-new"]);
    expect(store.tables.report_revisions.map((row) => row.id)).toEqual(["r-new"]);
    expect(store.tables.audit_state_transitions.map((row) => row.id)).toEqual([
      "t-new",
    ]);
    expect(store.tables.audit_events.map((row) => row.id)).toEqual(["v-new"]);
    expect(store.tables.criterion_results).toHaveLength(1);
    expect(store.tables.pillar_results).toHaveLength(1);
    expect(store.tables.leads).toHaveLength(1);
    expect(store.tables.meetings).toHaveLength(1);
    expect(store.tables.admin_reviews).toHaveLength(1);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0].job_name).toBe(STRUCTURED_DATA_JOB);
  });

  it("does not name indefinite-retention tables as delete targets", () => {
    const targeted = STRUCTURED_DATA_TARGETS.map((t) => t.table);
    for (const table of INDEFINITE_RETENTION_TABLES) {
      expect(targeted).not.toContain(table);
    }

    const source = readFileSync(
      resolve(process.cwd(), "lib/retention/purge.ts"),
      "utf8",
    );
    for (const table of INDEFINITE_RETENTION_TABLES) {
      expect(source).not.toMatch(
        new RegExp(`\\.from\\("${table}"\\)\\s*\\n?\\s*\\.delete`),
      );
    }
    expect(source).not.toContain("audit_pages");
  });
});

describe("combined retention purge", () => {
  it("records a run for each job even when both delete zero rows", async () => {
    const store = memoryStore({});
    const objects = memoryObjects([]);
    const result = await runRetentionPurge({
      store,
      objects,
      artifactDays: 90,
      dataDays: 365,
      now: NOW,
    });

    expect(result.artifacts.rowsDeleted).toBe(0);
    expect(result.structuredData.rowsDeleted).toBe(0);
    expect(store.runs.map((run) => run.job_name)).toEqual([
      ARTIFACTS_JOB,
      STRUCTURED_DATA_JOB,
    ]);
  });
});
