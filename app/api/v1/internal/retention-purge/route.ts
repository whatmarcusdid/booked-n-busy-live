import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/retention/auth";
import {
  createSupabaseArtifactObjectStore,
  createSupabaseRetentionStore,
  runRetentionPurge,
} from "@/lib/retention/purge";
import {
  retentionArtifactDays,
  retentionDataDays,
} from "@/lib/retention/config";

/**
 * Daily retention purge. Vercel Cron hits this with
 * `Authorization: Bearer $CRON_SECRET`. Both jobs run sequentially and each
 * writes a `retention_purge_runs` row, including zero-row executions.
 */
async function handle(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRetentionPurge({
      store: createSupabaseRetentionStore(),
      objects: createSupabaseArtifactObjectStore(),
      artifactDays: retentionArtifactDays(),
      dataDays: retentionDataDays(),
    });

    const statuses = [result.artifacts.status, result.structuredData.status];
    const status = statuses.includes("failed")
      ? 500
      : statuses.includes("partial")
        ? 207
        : 200;

    return NextResponse.json({
      ok: status === 200,
      artifacts: result.artifacts,
      structuredData: result.structuredData,
    }, { status });
  } catch (error) {
    console.error("retention-purge failed:", error);
    return NextResponse.json(
      { error: "Retention purge failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
