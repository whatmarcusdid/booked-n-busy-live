/**
 * Boot-time assertion that the database this process is pointed at actually
 * has the schema the code expects.
 *
 * This exists because of a real incident: four migrations were never applied
 * to an environment, and nothing noticed. Audit creation kept returning 202
 * while the pipeline died on missing tables, stranding every audit in
 * `submitted`. The database was reachable and the code was correct — they just
 * disagreed about what existed, and the only signal was a stranded row.
 *
 * Checked before the server accepts traffic, so a drifted environment fails
 * loudly at boot instead of silently at request time.
 */
import { describeDatabaseError } from "./errors";

/**
 * The RPC signature `lib/services/audit-service.ts` calls. PostgREST resolves
 * an RPC by its exact named-parameter set, so a signature drift is not a
 * degraded call — it is a hard "function not found" on every submission.
 */
export const REQUIRED_RPC_NAME = "create_audit_with_lead";

export const REQUIRED_RPC_PARAMETERS: readonly string[] = [
  "p_email_hash",
  "p_email",
  "p_first_name",
  "p_business_name",
  "p_phone",
  "p_trade",
  "p_service_area",
  "p_website_url",
  "p_primary_concern",
  "p_team_size",
  "p_platform",
  "p_referral_source",
  "p_consent_report_delivery",
  "p_consent_follow_up",
  "p_utm_source",
  "p_utm_medium",
  "p_utm_campaign",
  "p_utm_term",
  "p_utm_content",
  "p_landing_variant",
  "p_public_status_token_hash",
  "p_idempotency_key_hash",
];

/**
 * Tables and columns the request path depends on. Deliberately not the whole
 * schema: these are the ones whose absence produces a silent failure rather
 * than an obvious one.
 */
export const REQUIRED_TABLE_COLUMNS: Readonly<
  Record<string, readonly string[]>
> = {
  audits: [
    "id",
    "current_state",
    "public_status_token_hash",
    "idempotency_key_hash",
    "workflow_started_at",
    "cost_usd",
    "elapsed_ms",
    "kill_switch_reason",
    "retry_of_audit_id",
    "retry_attempt",
  ],
  leads: ["id", "email_hash", "email", "qualification_status", "qualified_at"],
  audit_cost_entries: [
    "audit_id",
    "operation_key",
    "category",
    "amount_usd",
    "pricing_source",
  ],
  booking_sessions: ["audit_id", "lead_id", "customer_email_hash"],
  pre_call_answers: [
    "audit_id",
    "lead_id",
    "finding_answer",
    "result_answer",
    "timing_answer",
    "submitted_at",
  ],
  report_revisions: ["scoring_band_version", "score_band"],
  // `rule_version` is recorded per result row, not on the revision.
  criterion_results: ["rule_version"],
  pillar_results: ["rule_version"],
};

export type ContractProblemKind = "unreachable" | "rpc" | "relation";

export interface ContractProblem {
  kind: ContractProblemKind;
  detail: string;
}

export interface ContractReport {
  ok: boolean;
  /** True when the database could not be inspected at all. */
  unreachable: boolean;
  problems: ContractProblem[];
}

export interface ContractDeps {
  /** Returns the PostgREST OpenAPI document describing exposed RPCs. */
  fetchOpenApi: () => Promise<unknown>;
  /**
   * Selects `columns` from `table` with no rows returned. Resolves to an error
   * description when the relation or a column is missing, or null when fine.
   */
  probeRelation: (
    table: string,
    columns: readonly string[],
  ) => Promise<string | null>;
}

function readRpcParameters(
  openApi: unknown,
  rpcName: string,
): string[] | null {
  const paths = (openApi as { paths?: Record<string, unknown> } | null)?.paths;
  const entry = paths?.[`/rpc/${rpcName}`] as
    | {
        post?: {
          parameters?: Array<{
            schema?: { properties?: Record<string, unknown> };
          }>;
        };
      }
    | undefined;

  const properties = entry?.post?.parameters?.[0]?.schema?.properties;
  if (!properties) return null;
  return Object.keys(properties);
}

export async function checkDatabaseContract(
  deps: ContractDeps,
): Promise<ContractReport> {
  const problems: ContractProblem[] = [];

  let openApi: unknown;
  try {
    openApi = await deps.fetchOpenApi();
  } catch (error) {
    return {
      ok: false,
      unreachable: true,
      problems: [
        {
          kind: "unreachable",
          detail: `could not read the database schema: ${describeDatabaseError(error)}`,
        },
      ],
    };
  }

  const actualParameters = readRpcParameters(openApi, REQUIRED_RPC_NAME);

  if (actualParameters === null) {
    problems.push({
      kind: "rpc",
      detail: `RPC ${REQUIRED_RPC_NAME} is not exposed by the database. Every audit submission will fail.`,
    });
  } else {
    const actual = new Set(actualParameters);
    const missing = REQUIRED_RPC_PARAMETERS.filter((p) => !actual.has(p));
    const unexpected = actualParameters.filter(
      (p) => !REQUIRED_RPC_PARAMETERS.includes(p),
    );

    if (missing.length > 0 || unexpected.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing [${missing.join(", ")}]`);
      if (unexpected.length > 0) {
        parts.push(`unexpected [${unexpected.join(", ")}]`);
      }
      problems.push({
        kind: "rpc",
        detail: `RPC ${REQUIRED_RPC_NAME} signature mismatch: ${parts.join("; ")}. PostgREST matches on the exact parameter set, so submissions will fail.`,
      });
    }
  }

  for (const [table, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    const failure = await deps.probeRelation(table, columns);
    if (failure) {
      problems.push({
        kind: "relation",
        detail: `${table}: ${failure}`,
      });
    }
  }

  return { ok: problems.length === 0, unreachable: false, problems };
}

export function formatContractFailure(report: ContractReport): string {
  const lines = [
    "",
    "=".repeat(72),
    "CRITICAL: database schema does not match this build.",
    "=".repeat(72),
    ...report.problems.map((p) => `  [${p.kind}] ${p.detail}`),
    "",
    "  Most likely cause: pending migrations have not been applied to this",
    "  environment. Run the outstanding migrations before serving traffic.",
    "=".repeat(72),
    "",
  ];
  return lines.join("\n");
}
