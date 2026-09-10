import {
  assessSecurityHealth,
  classifySecurityHealthProbe,
} from "@/lib/audit-workflow/rubric/security-health";
import {
  originUrlForScheme,
  probeHttpsScheme,
  tlsReasonFromError,
  type HttpsHopResult,
  type ProbeHttpsHop,
} from "@/lib/audit-workflow/https-probe";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import {
  fixFirstSeverityKey,
  fixFirstSeverityRank,
  isFixFirstEligible,
  selectFixFirst,
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

  it("expired certificate → https_cert_expired, not absence", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": {
          ok: false,
          kind: "tls",
          reasonCode: "https_cert_expired",
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
      reasonCode: "https_cert_expired",
      httpsAttempt: "tls_failed",
      usedHttpFallback: true,
    });
  });

  it("invalid / self-signed / mismatched certificate → https_cert_invalid", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": {
          ok: false,
          kind: "tls",
          reasonCode: "https_cert_invalid",
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
    expect(result.signal?.reasonCode).toBe("https_cert_invalid");
  });

  it("generic TLS handshake failure → https_tls_error, not absence", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": {
          ok: false,
          kind: "tls",
          reasonCode: "https_tls_error",
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
    expect(result.signal?.reasonCode).toBe("https_tls_error");
  });

  it("HTTP site redirecting to an unsafe destination stays https_absent", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": { ok: false, kind: "connection" },
        "http://example.com/": {
          ok: true,
          status: 302,
          location: "http://127.0.0.1/",
        },
      }),
    });

    const result = assessSecurityHealth({
      homeAssessed: true,
      finalUrl: "http://example.com/",
      probe,
    });

    expect(result.outcome).toBe("fail");
    expect(result.signal?.reasonCode).toBe("https_absent");
    expect(result.signal?.reasonCode).not.toBe("https_downgrade_redirect");
  });

  it("a mid-chain HTTPS→HTTP hop is a downgrade even if HTTPS is restored", async () => {
    const probe = await probeHttpsScheme({
      websiteUrl: "https://example.com",
      safetyDeps: { lookup },
      hopFetch: hopScript({
        "https://example.com/": {
          ok: true,
          status: 301,
          location: "http://example.com/",
        },
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
      finalUrl: "https://www.example.com/",
      probe,
    });

    expect(result.outcome).toBe("fail");
    expect(result.signal?.reasonCode).toBe("https_downgrade_redirect");
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
    expect(isFixFirstEligible(downgrade!)).toBe(true);
    expect(isFixFirstEligible(absent!)).toBe(true);
    expect(
      selectFixFirst([absent!, downgrade!], () => 0)[0]?.row.findings
        .reason_code,
    ).toBe("https_downgrade_redirect");
  });

  it("HTTPS timeout with working HTTP is not an active misconfiguration", async () => {
    const lookup = async () => [PUBLIC_IP];
    const auditId = "audit-https-timeout-ff";
    const store = seedStore(auditId, "https://slow.example");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://slow.example",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml("http://slow.example/"),
      safetyDeps: { lookup },
      probeHttpsHop: hopScript({
        "https://slow.example/": { ok: false, kind: "timeout" },
        "http://slow.example/": { ok: true, status: 200 },
      }),
    });

    const timeout = store.criteria.find(
      (row) => row.criterion_key === "security_health",
    );
    expect(timeout?.findings).toMatchObject({
      outcome: "fail",
      reason_code: "https_timeout",
      active_misconfiguration: false,
    });
    expect(fixFirstSeverityRank(timeout!)).toBe(4);
  });

  it("an expired-certificate fail outranks plain HTTPS absence in Fix First", async () => {
    const lookup = async () => [PUBLIC_IP];
    const absentAudit = "audit-https-absent-ff";
    const expiredAudit = "audit-https-expired-ff";
    const absentStore = seedStore(absentAudit, "https://http-only.example");
    const expiredStore = seedStore(expiredAudit, "https://expired.example");

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
      auditId: expiredAudit,
      websiteUrl: "https://expired.example",
      store: expiredStore,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml("http://expired.example/"),
      safetyDeps: { lookup },
      probeHttpsHop: hopScript({
        "https://expired.example/": {
          ok: false,
          kind: "tls",
          reasonCode: "https_cert_expired",
        },
        "http://expired.example/": { ok: true, status: 200 },
      }),
    });

    const absent = absentStore.criteria.find(
      (row) => row.criterion_key === "security_health",
    );
    const expired = expiredStore.criteria.find(
      (row) => row.criterion_key === "security_health",
    );

    expect(absent?.findings.active_misconfiguration).toBe(false);
    expect(expired?.findings).toMatchObject({
      outcome: "fail",
      reason_code: "https_cert_expired",
      active_misconfiguration: true,
    });
    expect(fixFirstSeverityRank(expired!)).toBe(1);
    expect(fixFirstSeverityRank(absent!)).toBe(4);
    expect(isFixFirstEligible(expired!)).toBe(true);
    expect(isFixFirstEligible(absent!)).toBe(true);
    const ranked = selectFixFirst(
      [absent!, expired!],
      () => 0,
    );
    expect(ranked[0]?.row.findings.reason_code).toBe("https_cert_expired");
  });
});

describe("tlsReasonFromError", () => {
  it("maps Node TLS codes onto Decision #11 reason codes", () => {
    expect(
      tlsReasonFromError({ code: "CERT_HAS_EXPIRED", message: "certificate has expired" }),
    ).toBe("https_cert_expired");
    expect(
      tlsReasonFromError({
        message: "fetch failed",
        cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      }),
    ).toBe("https_cert_invalid");
    expect(
      tlsReasonFromError({ cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }),
    ).toBe("https_cert_invalid");
    expect(tlsReasonFromError({ code: "ERR_SSL_WRONG_VERSION_NUMBER" })).toBe(
      "https_tls_error",
    );
    expect(tlsReasonFromError(new Error("ECONNREFUSED"))).toBeNull();
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
