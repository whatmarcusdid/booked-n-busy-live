/**
 * Wiring that runs the schema contract against the real database at boot.
 * The comparison itself lives in `schema-contract.ts` and stays pure.
 */
import { createAdminClient } from "./admin";
import { getServerEnv } from "../env";
import { describeDatabaseError } from "./errors";
import {
  checkDatabaseContract,
  formatContractFailure,
  type ContractDeps,
  type ContractReport,
} from "./schema-contract";

export function createContractDeps(): ContractDeps {
  const env = getServerEnv();
  if (!env) {
    throw new Error(
      "Cannot verify the database schema: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured.",
    );
  }

  return {
    async fetchOpenApi() {
      const response = await fetch(`${env.supabaseUrl}/rest/v1/`, {
        headers: {
          apikey: env.supabaseServiceRoleKey,
          Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `PostgREST schema request failed with ${response.status}`,
        );
      }

      return response.json();
    },

    async probeRelation(table, columns) {
      // `limit(0)` reads no rows: PostgREST still resolves the relation and
      // every named column, so a missing table or column errors here.
      const { error } = await createAdminClient()
        .from(table)
        .select(columns.join(","))
        .limit(0);

      return error ? describeDatabaseError(error) : null;
    },
  };
}

export interface AssertOptions {
  deps?: ContractDeps;
  /** Injected for testing the failure behaviour without killing the runner. */
  onFatal?: (message: string) => never;
  logger?: Pick<Console, "error" | "info">;
}

/**
 * Verify the database matches this build, before the server takes traffic.
 *
 * A confirmed mismatch is fatal: the environment is wrong and every request
 * would fail in a way that is hard to see. An unreachable database is loud but
 * not fatal, because that is a transient/ordering condition rather than a
 * disagreement about schema, and the database may come up after the process.
 */
export async function assertDatabaseContract(
  options: AssertOptions = {},
): Promise<ContractReport> {
  const logger = options.logger ?? console;
  const deps = options.deps ?? createContractDeps();
  const report = await checkDatabaseContract(deps);

  if (report.unreachable) {
    logger.error(
      `CRITICAL: could not verify the database schema at boot. ${report.problems
        .map((p) => p.detail)
        .join("; ")}`,
    );
    return report;
  }

  if (!report.ok) {
    const message = formatContractFailure(report);
    logger.error(message);
    const fatal =
      options.onFatal ??
      ((text: string) => {
        throw new Error(text);
      });
    fatal(message);
    return report;
  }

  logger.info("Database schema contract verified.");
  return report;
}
