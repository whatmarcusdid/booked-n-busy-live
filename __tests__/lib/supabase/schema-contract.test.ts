import {
  checkDatabaseContract,
  REQUIRED_RPC_NAME,
  REQUIRED_RPC_PARAMETERS,
  REQUIRED_TABLE_COLUMNS,
  type ContractDeps,
} from "@/lib/supabase/schema-contract";
import { assertDatabaseContract } from "@/lib/supabase/assert-schema";

function openApiWith(parameters: readonly string[]) {
  return {
    paths: {
      [`/rpc/${REQUIRED_RPC_NAME}`]: {
        post: {
          parameters: [
            {
              schema: {
                properties: Object.fromEntries(
                  parameters.map((name) => [name, { type: "string" }]),
                ),
              },
            },
          ],
        },
      },
    },
  };
}

function depsFor(overrides: Partial<ContractDeps> = {}): ContractDeps {
  return {
    fetchOpenApi: async () => openApiWith(REQUIRED_RPC_PARAMETERS),
    probeRelation: async () => null,
    ...overrides,
  };
}

const silentLogger = { error: () => {}, info: () => {} };

describe("database schema contract", () => {
  it("passes when the RPC signature and relations all match", async () => {
    const report = await checkDatabaseContract(depsFor());
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it("checks every relation the request path depends on", async () => {
    const probed: string[] = [];
    await checkDatabaseContract(
      depsFor({
        probeRelation: async (table) => {
          probed.push(table);
          return null;
        },
      }),
    );

    expect(probed.sort()).toEqual(Object.keys(REQUIRED_TABLE_COLUMNS).sort());
  });

  /**
   * The exact drift behind the incident: migrations that create
   * `audit_cost_entries` were never applied, so the pipeline died on a table
   * that did not exist while the app happily accepted submissions.
   */
  it("fails when a table from an unapplied migration is missing", async () => {
    const report = await checkDatabaseContract(
      depsFor({
        probeRelation: async (table) =>
          table === "audit_cost_entries"
            ? "message=relation \"public.audit_cost_entries\" does not exist | code=42P01"
            : null,
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].kind).toBe("relation");
    expect(report.problems[0].detail).toContain("audit_cost_entries");
  });

  it("fails when a single column is missing from an existing table", async () => {
    const report = await checkDatabaseContract(
      depsFor({
        probeRelation: async (table) =>
          table === "report_revisions"
            ? "message=column report_revisions.scoring_band_version does not exist | code=42703"
            : null,
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.problems[0].detail).toContain("scoring_band_version");
  });

  it("fails when the RPC is missing entirely", async () => {
    const report = await checkDatabaseContract(
      depsFor({ fetchOpenApi: async () => ({ paths: {} }) }),
    );

    expect(report.ok).toBe(false);
    expect(report.problems[0].kind).toBe("rpc");
    expect(report.problems[0].detail).toContain("not exposed");
  });

  /**
   * PostgREST resolves an RPC by its exact named-parameter set, so dropping or
   * adding one parameter is a hard failure on every submission, not a
   * degraded call.
   */
  it("fails when the RPC has drifted by one parameter", async () => {
    const withoutIdempotency = REQUIRED_RPC_PARAMETERS.filter(
      (p) => p !== "p_idempotency_key_hash",
    );

    const report = await checkDatabaseContract(
      depsFor({ fetchOpenApi: async () => openApiWith(withoutIdempotency) }),
    );

    expect(report.ok).toBe(false);
    expect(report.problems[0].detail).toContain("p_idempotency_key_hash");
    expect(report.problems[0].detail).toContain("missing");
  });

  it("flags an extra parameter the code does not send", async () => {
    const report = await checkDatabaseContract(
      depsFor({
        fetchOpenApi: async () =>
          openApiWith([...REQUIRED_RPC_PARAMETERS, "p_surprise"]),
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.problems[0].detail).toContain("p_surprise");
  });

  it("reports an unreachable database separately from a mismatch", async () => {
    const report = await checkDatabaseContract(
      depsFor({
        fetchOpenApi: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:54321");
        },
      }),
    );

    expect(report.unreachable).toBe(true);
    expect(report.problems[0].kind).toBe("unreachable");
    expect(report.problems[0].detail).toContain("ECONNREFUSED");
  });
});

describe("boot assertion behaviour", () => {
  it("throws on a confirmed mismatch so the server cannot take traffic", async () => {
    await expect(
      assertDatabaseContract({
        deps: depsFor({
          probeRelation: async (table) =>
            table === "booking_sessions" ? "does not exist" : null,
        }),
        logger: silentLogger,
      }),
    ).rejects.toThrow(/CRITICAL/);
  });

  it("names the likely cause so the operator knows what to run", async () => {
    let logged = "";
    await assertDatabaseContract({
      deps: depsFor({
        probeRelation: async (table) =>
          table === "booking_sessions" ? "does not exist" : null,
      }),
      logger: { error: (m: string) => (logged = m), info: () => {} },
      onFatal: (() => undefined) as unknown as (m: string) => never,
    });

    expect(logged).toContain("CRITICAL");
    expect(logged).toContain("migrations");
    expect(logged).toContain("booking_sessions");
  });

  it("does not throw when the database is merely unreachable", async () => {
    const report = await assertDatabaseContract({
      deps: depsFor({
        fetchOpenApi: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
      logger: silentLogger,
    });

    expect(report.unreachable).toBe(true);
  });

  it("passes quietly when the schema matches", async () => {
    const report = await assertDatabaseContract({
      deps: depsFor(),
      logger: silentLogger,
    });
    expect(report.ok).toBe(true);
  });
});
