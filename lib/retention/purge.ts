import { createAdminClient } from "../supabase/admin";
import { AUDIT_ARTIFACTS_BUCKET } from "../storage/audit-artifacts";
import {
  cutoffFromDays,
  retentionArtifactDays,
  retentionDataDays,
} from "./config";

export const ARTIFACTS_JOB = "artifacts";
export const STRUCTURED_DATA_JOB = "structured_data";

export const PURGE_STATUSES = ["success", "partial", "failed"] as const;
export type PurgeStatus = (typeof PURGE_STATUSES)[number];

/**
 * Tables Decision #10 retains indefinitely. The structured-data job must
 * never issue a delete against these names.
 */
export const INDEFINITE_RETENTION_TABLES = [
  "criterion_results",
  "pillar_results",
  "leads",
  "meetings",
  "admin_reviews",
] as const;

export const STRUCTURED_DATA_TARGETS = [
  { table: "evidence", column: "created_at" },
  { table: "report_revisions", column: "created_at" },
  { table: "audit_state_transitions", column: "transitioned_at" },
  { table: "audit_events", column: "created_at" },
] as const;

const PURGE_BATCH = 200;

export interface ArtifactRow {
  id: string;
  storage_key: string;
}

export interface PurgeRunRecord {
  job_name: string;
  started_at: string;
  completed_at: string;
  rows_deleted: number;
  objects_deleted: number;
  cutoff_used: string;
  status: PurgeStatus;
  error_detail: string | null;
}

export interface RetentionStore {
  listExpiredArtifacts(cutoff: Date): Promise<ArtifactRow[]>;
  deleteArtifacts(ids: string[]): Promise<number>;
  deleteOlderThan(
    table: (typeof STRUCTURED_DATA_TARGETS)[number]["table"],
    column: (typeof STRUCTURED_DATA_TARGETS)[number]["column"],
    cutoff: Date,
  ): Promise<number>;
  insertPurgeRun(run: PurgeRunRecord): Promise<void>;
}

export interface ArtifactObjectStore {
  /**
   * Remove Storage objects. Must not throw when a key is already gone —
   * a second run of the same job is a no-op, not a failure.
   */
  remove(keys: string[]): Promise<{ removed: number; failed: number }>;
}

export interface JobResult {
  jobName: string;
  status: PurgeStatus;
  rowsDeleted: number;
  objectsDeleted: number;
  cutoffUsed: Date;
  errorDetail: string | null;
}

export function isBenignStorageError(error: unknown): boolean {
  const msg = storageErrorMessage(error).toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("not exist") ||
    msg.includes("no such file")
  );
}

function storageErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function runArtifactPurge(input: {
  store: RetentionStore;
  objects: ArtifactObjectStore;
  days?: number;
  now?: Date;
}): Promise<JobResult> {
  const now = input.now ?? new Date();
  const days = input.days ?? retentionArtifactDays();
  const cutoff = cutoffFromDays(days, now);
  const startedAt = now;
  let rowsDeleted = 0;
  let objectsDeleted = 0;
  let status: PurgeStatus = "success";
  let errorDetail: string | null = null;

  try {
    const expired = await input.store.listExpiredArtifacts(cutoff);
    if (expired.length === 0) {
      await writeRun(input.store, {
        jobName: ARTIFACTS_JOB,
        startedAt,
        now,
        cutoff,
        rowsDeleted: 0,
        objectsDeleted: 0,
        status: "success",
        errorDetail: null,
      });
      return {
        jobName: ARTIFACTS_JOB,
        status: "success",
        rowsDeleted: 0,
        objectsDeleted: 0,
        cutoffUsed: cutoff,
        errorDetail: null,
      };
    }

    const keys = expired.map((row) => row.storage_key);
    const removed = await input.objects.remove(keys);
    objectsDeleted = removed.removed;

    if (removed.failed > 0) {
      status = "partial";
      errorDetail = `${removed.failed} storage object(s) could not be deleted`;
    } else {
      const ids = expired.map((row) => row.id);
      rowsDeleted = await input.store.deleteArtifacts(ids);
    }
  } catch (error) {
    status = "failed";
    errorDetail = error instanceof Error ? error.message : String(error);
  }

  await writeRun(input.store, {
    jobName: ARTIFACTS_JOB,
    startedAt,
    now: new Date(),
    cutoff,
    rowsDeleted,
    objectsDeleted,
    status,
    errorDetail,
  });

  return {
    jobName: ARTIFACTS_JOB,
    status,
    rowsDeleted,
    objectsDeleted,
    cutoffUsed: cutoff,
    errorDetail,
  };
}

export async function runStructuredDataPurge(input: {
  store: RetentionStore;
  days?: number;
  now?: Date;
}): Promise<JobResult> {
  const now = input.now ?? new Date();
  const days = input.days ?? retentionDataDays();
  const cutoff = cutoffFromDays(days, now);
  const startedAt = now;
  let rowsDeleted = 0;
  let status: PurgeStatus = "success";
  let errorDetail: string | null = null;

  try {
    for (const target of STRUCTURED_DATA_TARGETS) {
      rowsDeleted += await input.store.deleteOlderThan(
        target.table,
        target.column,
        cutoff,
      );
    }
  } catch (error) {
    status = "failed";
    errorDetail = error instanceof Error ? error.message : String(error);
  }

  await writeRun(input.store, {
    jobName: STRUCTURED_DATA_JOB,
    startedAt,
    now: new Date(),
    cutoff,
    rowsDeleted,
    objectsDeleted: 0,
    status,
    errorDetail,
  });

  return {
    jobName: STRUCTURED_DATA_JOB,
    status,
    rowsDeleted,
    objectsDeleted: 0,
    cutoffUsed: cutoff,
    errorDetail,
  };
}

export async function runRetentionPurge(input: {
  store: RetentionStore;
  objects: ArtifactObjectStore;
  artifactDays?: number;
  dataDays?: number;
  now?: Date;
}): Promise<{ artifacts: JobResult; structuredData: JobResult }> {
  const artifacts = await runArtifactPurge({
    store: input.store,
    objects: input.objects,
    days: input.artifactDays,
    now: input.now,
  });
  const structuredData = await runStructuredDataPurge({
    store: input.store,
    days: input.dataDays,
    now: input.now,
  });
  return { artifacts, structuredData };
}

async function writeRun(
  store: RetentionStore,
  input: {
    jobName: string;
    startedAt: Date;
    now: Date;
    cutoff: Date;
    rowsDeleted: number;
    objectsDeleted: number;
    status: PurgeStatus;
    errorDetail: string | null;
  },
): Promise<void> {
  await store.insertPurgeRun({
    job_name: input.jobName,
    started_at: input.startedAt.toISOString(),
    completed_at: input.now.toISOString(),
    rows_deleted: input.rowsDeleted,
    objects_deleted: input.objectsDeleted,
    cutoff_used: input.cutoff.toISOString(),
    status: input.status,
    error_detail: input.errorDetail,
  });
}

export function createSupabaseRetentionStore(
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
): RetentionStore {
  return {
    async listExpiredArtifacts(cutoff) {
      const rows: ArtifactRow[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await client
          .from("artifacts")
          .select("id, storage_key")
          .lt("created_at", cutoff.toISOString())
          .order("created_at", { ascending: true })
          .range(from, from + PURGE_BATCH - 1);
        if (error) {
          throw new Error(`Failed to list expired artifacts: ${error.message}`);
        }
        const batch = (data ?? []) as ArtifactRow[];
        rows.push(...batch);
        if (batch.length < PURGE_BATCH) break;
        from += PURGE_BATCH;
      }
      return rows;
    },

    async deleteArtifacts(ids) {
      if (ids.length === 0) return 0;
      let deleted = 0;
      for (let i = 0; i < ids.length; i += PURGE_BATCH) {
        const chunk = ids.slice(i, i + PURGE_BATCH);
        const { data, error } = await client
          .from("artifacts")
          .delete()
          .in("id", chunk)
          .select("id");
        if (error) {
          throw new Error(`Failed to delete artifacts: ${error.message}`);
        }
        deleted += data?.length ?? 0;
      }
      return deleted;
    },

    async deleteOlderThan(table, column, cutoff) {
      let deleted = 0;
      for (;;) {
        const { data, error } = await client
          .from(table)
          .select("id")
          .lt(column, cutoff.toISOString())
          .limit(PURGE_BATCH);
        if (error) {
          throw new Error(
            `Failed to list expired ${table} rows: ${error.message}`,
          );
        }
        const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
        if (ids.length === 0) return deleted;
        const { error: deleteError } = await client
          .from(table)
          .delete()
          .in("id", ids);
        if (deleteError) {
          throw new Error(
            `Failed to delete expired ${table} rows: ${deleteError.message}`,
          );
        }
        deleted += ids.length;
        if (ids.length < PURGE_BATCH) break;
      }
      return deleted;
    },

    async insertPurgeRun(run) {
      const { error } = await client.from("retention_purge_runs").insert(run);
      if (error) {
        throw new Error(`Failed to record purge run: ${error.message}`);
      }
    },
  };
}

export function createSupabaseArtifactObjectStore(
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
): ArtifactObjectStore {
  return {
    async remove(keys) {
      if (keys.length === 0) return { removed: 0, failed: 0 };
      let removed = 0;
      let failed = 0;
      for (let i = 0; i < keys.length; i += PURGE_BATCH) {
        const chunk = keys.slice(i, i + PURGE_BATCH);
        try {
          const { error } = await client.storage
            .from(AUDIT_ARTIFACTS_BUCKET.id)
            .remove(chunk);
          if (!error) {
            removed += chunk.length;
            continue;
          }
          if (isBenignStorageError(error)) {
            removed += chunk.length;
            continue;
          }
          failed += chunk.length;
        } catch (error) {
          if (isBenignStorageError(error)) {
            removed += chunk.length;
            continue;
          }
          failed += chunk.length;
        }
      }
      return { removed, failed };
    },
  };
}
