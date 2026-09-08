import {
  assessUrlSafety,
  customerMessageFor,
  URL_SAFETY_BOUNDS,
} from "@/lib/url-safety";

const PUBLIC_IP = "93.184.216.34";

function lookupOf(addresses: string[]) {
  return async () => addresses;
}

describe("assessUrlSafety", () => {
  it("normalizes a bare domain to https and allows a public host", async () => {
    const result = await assessUrlSafety("example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalizedUrl).toBe("https://example.com/");
      expect(result.bounds.maxPagesPerDomain).toBe(
        URL_SAFETY_BOUNDS.maxPagesPerDomain,
      );
      expect(result.bounds.maxFetchDurationMs).toBe(
        URL_SAFETY_BOUNDS.maxFetchDurationMs,
      );
      expect(result.bounds.maxPerformanceFetchMs).toBe(
        URL_SAFETY_BOUNDS.maxPerformanceFetchMs,
      );
      expect(result.bounds.maxPerformanceFetchMs).toBeGreaterThan(
        URL_SAFETY_BOUNDS.maxFetchDurationMs,
      );
      expect(result.bounds.maxResponseBytes).toBe(
        URL_SAFETY_BOUNDS.maxResponseBytes,
      );
    }
  });

  it("rejects credentials embedded in the URL", async () => {
    const result = await assessUrlSafety("https://user:pass@example.com", {
      lookup: lookupOf([PUBLIC_IP]),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "CREDENTIALS_IN_URL",
    });
    if (!result.ok) {
      expect(result.customerMessage).not.toContain("user");
      expect(result.customerMessage).not.toContain("pass");
    }
  });

  it("rejects a disallowed protocol", async () => {
    const result = await assessUrlSafety("ftp://example.com");
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "DISALLOWED_PROTOCOL",
    });
  });

  it("rejects a disallowed port", async () => {
    const result = await assessUrlSafety("https://example.com:8080", {
      lookup: lookupOf([PUBLIC_IP]),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "DISALLOWED_PORT",
    });
  });

  it("rejects localhost by name", async () => {
    const result = await assessUrlSafety("http://localhost", {
      lookup: lookupOf(["127.0.0.1"]),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_HOST" });
  });

  it("rejects loopback IPv4", async () => {
    const result = await assessUrlSafety("http://127.0.0.1");
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
  });

  it.each([
    ["10.0.0.0/8", "http://10.1.2.3"],
    ["172.16.0.0/12", "http://172.16.4.5"],
    ["192.168.0.0/16", "http://192.168.10.20"],
    ["100.64.0.0/10 CGNAT", "http://100.64.0.1"],
    ["169.254.0.0/16 link-local", "http://169.254.1.1"],
    ["169.254.169.254 metadata", "http://169.254.169.254"],
    ["224.0.0.0/4 multicast", "http://224.0.0.1"],
    ["240.0.0.0/4 reserved", "http://240.0.0.1"],
  ])("rejects private/special IPv4 %s", async (_label, url) => {
    const result = await assessUrlSafety(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BLOCKED_ADDRESS");
      expect(result.customerMessage).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it.each([
    ["loopback", "http://[::1]"],
    ["link-local", "http://[fe80::1]"],
    ["unique-local", "http://[fd12:3456:789a:1::1]"],
    ["multicast", "http://[ff02::1]"],
    ["IPv4-mapped private", "http://[::ffff:192.168.0.10]"],
  ])("rejects IPv6 %s", async (_label, url) => {
    const result = await assessUrlSafety(url);
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
  });

  it("rejects a public hostname that resolves to a private IP", async () => {
    const result = await assessUrlSafety("https://shop.example.com", {
      lookup: lookupOf(["10.0.0.8"]),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "BLOCKED_ADDRESS",
    });
    if (!result.ok) {
      expect(result.customerMessage).not.toContain("10.0.0.8");
      expect(result.customerMessage).toBe(
        customerMessageFor("BLOCKED_ADDRESS"),
      );
    }
  });

  it("rejects when any resolved address is private", async () => {
    const result = await assessUrlSafety("https://shop.example.com", {
      lookup: lookupOf([PUBLIC_IP, "192.168.1.4"]),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "BLOCKED_ADDRESS" });
  });

  it("rejects a redirect whose destination is private", async () => {
    const result = await assessUrlSafety("https://example.com", {
      lookup: async (hostname) =>
        hostname === "example.com" ? [PUBLIC_IP] : ["192.168.0.2"],
      probe: async (url) =>
        url.startsWith("https://example.com")
          ? { status: 302, location: "https://internal.example.com/admin" }
          : { status: 200 },
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "BLOCKED_ADDRESS",
    });
  });

  it("rejects when the redirect hop count is exceeded", async () => {
    let hop = 0;
    const result = await assessUrlSafety("https://example.com", {
      lookup: lookupOf([PUBLIC_IP]),
      bounds: { maxRedirects: 2 },
      probe: async () => {
        hop += 1;
        return { status: 302, location: `https://example.com/r${hop}` };
      },
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "TOO_MANY_REDIRECTS",
    });
  });

  it("revalidates each redirect destination before following it", async () => {
    const seen: string[] = [];
    const result = await assessUrlSafety("https://example.com/start", {
      lookup: lookupOf([PUBLIC_IP]),
      probe: async (url) => {
        seen.push(url);
        if (url.includes("/start")) {
          return { status: 301, location: "https://cdn.example.com/ok" };
        }
        return { status: 200 };
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://cdn.example.com/ok");
    }
    expect(seen[0]).toContain("example.com/start");
  });

  it("rejects DNS resolution failures without leaking lookup details", async () => {
    const result = await assessUrlSafety("https://missing.example", {
      lookup: async () => {
        throw new Error("ENOTFOUND 10.0.0.9");
      },
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "DNS_FAILED" });
    if (!result.ok) {
      expect(result.customerMessage).not.toContain("10.0.0.9");
      expect(result.customerMessage).not.toContain("ENOTFOUND");
    }
  });
});
