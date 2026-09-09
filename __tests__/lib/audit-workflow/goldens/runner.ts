import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { SCORING_BAND_VERSION } from "@/lib/audit-workflow/rubric/bands";
import { RULE_VERSION } from "@/lib/audit-workflow/rubric/model";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import { PILLARS } from "@/lib/audit-workflow/types";
import type { CaptureScreenshot, FetchPagePerformance, FetchRenderedPage } from "@/lib/browserless";
import type { ArtifactStorage } from "@/lib/storage/audit-artifacts";
import { CATALOG_KEYS, type GoldenInput, type GoldenManifest, type LoadedFixture } from "./types";

const PUBLIC_IP = "93.184.216.34";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const FIXTURES_DIR = join(__dirname, "fixtures");

export function loadGoldenFixtures(dir: string = FIXTURES_DIR): LoadedFixture[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folder = join(dir, entry.name);
      const input = JSON.parse(
        readFileSync(join(folder, "input.json"), "utf8"),
      ) as GoldenInput;
      const manifest = JSON.parse(
        readFileSync(join(folder, "manifest.json"), "utf8"),
      ) as GoldenManifest;
      let homeHtml: string | undefined;
      try {
        homeHtml = readFileSync(join(folder, "home.html"), "utf8");
      } catch {
        homeHtml = undefined;
      }
      return { name: entry.name, input, manifest, homeHtml };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function fetchHtml(html: string, homeUrl: string): FetchRenderedPage {
  return async ({ url }) => {
    if (url.replace(/\/$/, "") !== homeUrl.replace(/\/$/, "")) {
      return { ok: false, reasonCode: "FETCH_FAILED" };
    }
    return {
      ok: true,
      html,
      status: 200,
      finalUrl: homeUrl,
      redirected: false,
    };
  };
}

function fetchForbidden(): FetchRenderedPage {
  return async () => ({
    ok: false,
    reasonCode: "FETCH_FAILED",
    diagnostic: {
      reasonCode: "FETCH_FAILED",
      failureType: "NON_2XX_STATUS",
      httpStatus: 403,
    },
  });
}

function fetchPerformanceScore(score: number): FetchPagePerformance {
  return async () => ({
    ok: true,
    metrics: { score, lcpMs: 1800, tbtMs: 150, cls: 0.04 },
  });
}

function fetchPerformanceTimeout(): FetchPagePerformance {
  return async () => ({ ok: false, reasonCode: "FETCH_TIMEOUT" });
}

const successfulShot: CaptureScreenshot = async ({ url }) => ({
  ok: true,
  bytes: PNG,
  mimeType: "image/png",
  finalUrl: url,
  redirected: false,
});

function memoryStorage(): ArtifactStorage {
  return {
    async upload() {
      return { ok: true };
    },
  };
}

export async function runGoldenFixture(fixture: LoadedFixture) {
  const { input, homeHtml } = fixture;
  const store = createMemoryAuditStore([
    {
      id: input.auditId,
      website_url: input.websiteUrl,
      current_state: "submitted",
    },
  ]);

  let fetchHomePage: FetchRenderedPage;
  let fetchPerformance: FetchPagePerformance;

  if (input.kind === "unsupported_access") {
    fetchHomePage = fetchForbidden();
    fetchPerformance = fetchPerformanceTimeout();
  } else if (input.kind === "performance_timeout") {
    if (!homeHtml) {
      throw new Error(`${fixture.name}: performance_timeout fixtures need home.html`);
    }
    fetchHomePage = fetchHtml(homeHtml, input.websiteUrl);
    fetchPerformance = fetchPerformanceTimeout();
  } else {
    if (!homeHtml) {
      throw new Error(`${fixture.name}: html fixtures need home.html`);
    }
    if (typeof input.performanceScore !== "number") {
      throw new Error(`${fixture.name}: html fixtures need performanceScore`);
    }
    fetchHomePage = fetchHtml(homeHtml, input.websiteUrl);
    fetchPerformance = fetchPerformanceScore(input.performanceScore);
  }

  const result = await runAuditPipeline({
    auditId: input.auditId,
    websiteUrl: input.websiteUrl,
    store,
    delayMs: 0,
    outcome: "complete",
    realScanEnabled: true,
    fetchHomePage,
    fetchPerformance,
    captureScreenshot: successfulShot,
    artifactStorage: memoryStorage(),
    safetyDeps: { lookup: async () => [PUBLIC_IP] },
  });

  const criteria = store.criteria.filter((row) => row.auditId === input.auditId);
  const pillars = store.pillars.filter((row) => row.auditId === input.auditId);
  const recommendations = store.recommendations
    .filter((row) => row.auditId === input.auditId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const outcomes = Object.fromEntries(
    CATALOG_KEYS.map((key) => {
      const row = criteria.find((item) => item.criterion_key === key);
      const outcome = row?.findings.outcome;
      return [key, typeof outcome === "string" ? outcome : null];
    }),
  );

  const pillarScores = Object.fromEntries(
    PILLARS.map((pillar) => {
      const row = pillars.find((item) => item.pillar_key === pillar.key);
      return [pillar.key, row?.score ?? null];
    }),
  );

  const coverage = Object.fromEntries(
    PILLARS.map((pillar) => {
      const rows = criteria.filter((item) => item.pillar === pillar.key);
      const assessed = rows.filter((item) => item.findings.assessed === true).length;
      const notAssessed = rows.filter(
        (item) => item.findings.assessed !== true,
      ).length;
      const stored = pillars.find((item) => item.pillar_key === pillar.key);
      return [
        pillar.key,
        {
          assessed: stored?.criteria_count ?? assessed,
          not_assessed: notAssessed,
        },
      ];
    }),
  );

  const report = store.reports[0];
  const assembled = report?.metadata?.assembled as
    | { overallScore: number | null; band: { key: string } | null }
    | undefined;

  return {
    result,
    store,
    outcomes,
    pillarScores,
    coverage,
    recommendations,
    compositeScore: assembled?.overallScore ?? null,
    // Read from the queryable columns, not the metadata blob, so the golden
    // suite covers what pilot analysis will actually group by.
    scoreBand: report?.score_band ?? null,
    scoringBandVersion: report?.scoring_band_version ?? SCORING_BAND_VERSION,
    humanReviewRequired: result === "needs_review",
    rubricVersion: RULE_VERSION,
  };
}
