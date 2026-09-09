import {
  assessSecurityHealth,
  classifySecurityHealthProbe,
} from "@/lib/audit-workflow/rubric/security-health";
import {
  originUrlForScheme,
  probeHttpsScheme,
  type HttpsHopResult,
  type ProbeHttpsHop,
} from "@/lib/audit-workflow/https-probe";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import {
  fixFirstSeverityKey,
  fixFirstSeverityRank,
} from "@/lib/audit-workflow/fix-first";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";

const PUBLIC_IP = "93.184.216.34";
const HOME_HTML = `<html><head><title>Plumber</title></head><body>
<header><a href="tel:+15551234567">Call (555) 123-4567</a></header>
</body></html>`;

function seedStore(auditId: string, websiteUrl: string) {
  return createMemoryAuditStore([
    {
      id: auditId,
      website_url: websiteUrl,
      current_state: "submitted",
    },
  ]);
}

function fetchHtml(url: string): FetchRenderedPage {
  return async () => ({
    ok: true,
    html: HOME_HTML,
    status: 200,
    finalUrl: url,
    redirected: false,
  });
}

function hopScript(
  script: Record<string, HttpsHopResult>,
  seen: string[] = [],
): ProbeHttpsHop {
  return async (url) => {
    seen.push(url);
    const result = script[url];
    if (!result) {
      throw new Error(`unexpected hop ${url}`);
    }
    return result;
  };
}

describe("originUrlForScheme", () => {
  it("strips path and query so the probe is about the domain listener", () => {
    expect(
      originUrlForScheme("https://example.com/services?q=1", "https"),
    ).toBe("https://example.com/");
    expect(originUrlForScheme("https://example.com/services", "http")).toBe(
      "http://example.com/",
    );
  });
});

describe("security_health HTTPS-first probe", () => {
  const lookup = async () => [PUBLIC_IP];

  it("HTTP-only site with no HTTPS listener → https_absent", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": { ok: false, kind: "connection" },
        "http://example.com/": { ok: true, status: 200 },
      }),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "http://example.com/",
      probe,
    });

    expect(result.outcome).toBe("fail");
    expect(result.signal).toMatchObject({
      protocol: "http",
      reasonCode: "https_absent",
      usedHttpFallback: true,
      httpsAttempt: "connection_failed",
      schemes: ["http"],
    });
  });

  it("safe HTTP→HTTPS redirect after HTTPS connection failure → pass", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": { ok: false, kind: "connection" },
        "http://example.com/": {
          ok: true,
          status: 301,
          location: "https://www.example.com/",
        },
        "https://www.example.com/": { ok: true, status: 200 },
      }),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "http://example.com/",
      probe,
    });

    expect(result.outcome).toBe("pass");
    expect(result.signal).toMatchObject({
      protocol: "https",
      usedHttpFallback: true,
      schemes: ["http", "https"],
    });
    expect(result.signal?.reasonCode).toBeUndefined();
  });

  it("HTTPS end-to-end continues to pass", async () => {
    const seen: string[] = [];
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript(
        {
          "https://example.com/": { ok: true, status: 200 },
        },
        seen,
      ),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "https://example.com/",
      probe,
    });

    expect(result.outcome).toBe("pass");
    expect(result.signal?.protocol).toBe("https");
    expect(result.signal?.reasonCode).toBeUndefined();
    expect(seen).toEqual(["https://example.com/"]);
  });

  it("HTTPS→HTTP downgrade redirect → https_downgrade_redirect", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": {
          ok: true,
          status: 301,
          location: "http://example.com/",
        },
        "http://example.com/": { ok: true, status: 200 },
      }),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "http://example.com/",
      probe,
    });

    expect(result.outcome).toBe("fail");
    expect(result.signal).toMatchObject({
      protocol: "http",
      reasonCode: "https_downgrade_redirect",
      usedHttpFallback: false,
      httpsAttempt: "responded",
      schemes: ["https", "http"],
    });
  });

  it("HTTPS timeout with working HTTP fallback → https_timeout", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": { ok: false, kind: "timeout" },
        "http://example.com/": { ok: true, status: 200 },
      }),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "http://example.com/",
      probe,
    });

    expect(result.outcome).toBe("fail");
    expect(result.signal).toMatchObject({
      protocol: "http",
      reasonCode: "https_timeout",
      usedHttpFallback: true,
      httpsAttempt: "timeout",
    });
  });

  it("does not fall back to HTTP on an HTTP-level 401 over working HTTPS", async () => {
    const seen: string[] = [];
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript(
        {
          "https://example.com/": { ok: true, status: 401 },
        },
        seen,
      ),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "https://example.com/",
      probe,
    });

    expect(result.outcome).toBe("pass");
    expect(result.signal?.protocol).toBe("https");
    expect(seen).toEqual(["https://example.com/"]);
  });
});

describe("a downgrade and a plain-HTTP site remain distinguishable", () => {
  it("produce different reason codes and Fix First severity, both still fail", async () => {
    const lookup = async () => [PUBLIC_IP];

    const absentAudit = "audit-https-absent";
    const downgradeAudit = "audit-https-downgrade";
    const absentStore = seedStore(absentAudit, "https://http-only.example");
    const downgradeStore = seedStore(downgradeAudit, "https://downgrade.example");

    await runAuditPipeline({
      auditId: absentAudit,
      websiteUrl: "https://http-only.example",
      store: absentStore,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml("http://http-only.example/"),
      safetyDeps: { lookup },
      probeHttpsHop: hopScript({
        "https://http-only.example/": { ok: false, kind: "connection" },
        "http://http-only.example/": { ok: true, status: 200 },
      }),
    });

    await runAuditPipeline({
      auditId: downgradeAudit,
      websiteUrl: "https://downgrade.example",
      store: downgradeStore,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml("http://downgrade.example/"),
      safetyDeps: { lookup },
      probeHttpsHop: hopScript({
        "https://downgrade.example/": {
          ok: true,
          status: 301,
          location: "http://downgrade.example/",
        },
        "http://downgrade.example/": { ok: true, status: 200 },
      }),
    });

    const absent = absentStore.criteria.find(
      (row) => row.criterion_key === "security_health",
    );
    const downgrade = downgradeStore.criteria.find(
      (row) => row.criterion_key === "security_health",
    );

    expect(absent?.findings).toMatchObject({
      outcome: "fail",
      reason_code: "https_absent",
      active_misconfiguration: false,
    });
    expect(downgrade?.findings).toMatchObject({
      outcome: "fail",
      reason_code: "https_downgrade_redirect",
      active_misconfiguration: true,
      schemes: ["https", "http"],
    });

    expect(absent?.findings.reason_code).not.toBe(
      downgrade?.findings.reason_code,
    );
    expect(fixFirstSeverityKey(absent!)).toBe("growth_discovery");
    expect(fixFirstSeverityRank(absent!)).toBe(4);
    expect(fixFirstSeverityKey(downgrade!)).toBe("active_misconfiguration");
    expect(fixFirstSeverityRank(downgrade!)).toBe(1);
  });
});

describe("classifySecurityHealthProbe", () => {
  it("does not invent TLS certificate reason codes", () => {
    const classified = classifySecurityHealthProbe({
      schemes: ["http"],
      hops: [{ url: "http://example.com/", scheme: "http", status: 200 }],
      initialScheme: "https",
      finalScheme: "http",
      finalUrl: "http://example.com/",
      httpsAttempt: "connection_failed",
      usedHttpFallback: true,
    });
    expect(classified.signal?.reasonCode).toBe("https_absent");
    expect(classified.signal?.reasonCode).not.toMatch(/tls|cert/i);
  });
});
