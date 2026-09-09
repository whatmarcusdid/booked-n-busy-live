/**
 * `register()` runs once per server instance and completes before the server
 * handles requests, which is the only place a schema check can stop a drifted
 * environment from serving traffic.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JEST_WORKER_ID) return;
  if (process.env.SKIP_DB_SCHEMA_CHECK === "true") return;

  const { assertDatabaseContract } = await import(
    "./lib/supabase/assert-schema"
  );

  await assertDatabaseContract();
}
