import {
  resolveUrlSafely,
  URL_SAFETY_BOUNDS,
  type ProbeRedirectHop,
} from "@/lib/url-safety";

const PUBLIC_IP = "93.184.216.34";
const lookup = async () => [PUBLIC_IP];

describe("resolveUrlSafely", () => {
  it("revalidates each hop and returns the final URL for a safe HTTP→HTTPS redirect", async () => {
    const seen: string[] = [];
    const hopFetch: ProbeRedirectHop = async (url) => {
      seen.push(url);
      if (url === "http://example.com/") {
        return { ok: true, status: 301, location: "https://example.com/" };
      }
      return { ok: true, status: 200 };
    };

    const started = Date.now();
    const result = await resolveUrlSafely("http://example.com", {
      lookup,
      hopFetch,
    });
    const elapsedMs = Date.now() - started;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://example.com/");
      expect(result.hops).toHaveLength(2);
    }
    expect(seen).toEqual(["http://example.com/", "https://example.com/"]);
    // Injected hops are local; extra pre-flight time should be well under 50ms/hop.
    expect(elapsedMs).toBeLessThan(100);
  });

  it("rejects a redirect to a private IP before the dest is fetched", async () => {
    const seen: string[] = [];
    const hopFetch: ProbeRedirectHop = async (url) => {
      seen.push(url);
      if (url.startsWith("https://example.com")) {
        return { ok: true, status: 302, location: "http://127.0.0.1/" };
      }
      throw new Error(`must not fetch ${url}`);
    };

    const result = await resolveUrlSafely("https://example.com", {
      lookup,
      hopFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BLOCKED_ADDRESS");
      expect(result.rejectedHop).toBe(1);
      expect(result.rejectedUrl).toContain("127.0.0.1");
    }
    expect(seen).toEqual(["https://example.com/"]);
  });

  it("rejects a redirect to a prohibited-content domain before fetch", async () => {
    const seen: string[] = [];
    const hopFetch: ProbeRedirectHop = async (url) => {
      seen.push(url);
      if (url.includes("innocent")) {
        return {
          ok: true,
          status: 302,
          location: "https://freepornvideos.com/",
        };
      }
      throw new Error(`must not fetch ${url}`);
    };

    const result = await resolveUrlSafely("https://innocent.example.com", {
      lookup,
      hopFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROHIBITED_CONTENT");
      expect(result.prohibited?.category).toBe("adult");
      expect(result.rejectedHop).toBe(1);
    }
    expect(seen.some((url) => url.includes("freepornvideos"))).toBe(false);
  });

  it("rejects when the hop count exceeds the 5-hop maximum", async () => {
    let hop = 0;
    const hopFetch: ProbeRedirectHop = async () => {
      hop += 1;
      return { ok: true, status: 302, location: `https://example.com/r${hop}` };
    };

    const result = await resolveUrlSafely("https://example.com", {
      lookup,
      hopFetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("TOO_MANY_REDIRECTS");
    }
    expect(hop).toBe(URL_SAFETY_BOUNDS.maxRedirects + 1);
  });

  it("does not fetch a hop until assessUrlSafety has passed it", async () => {
    const fetched: string[] = [];
    const hopFetch: ProbeRedirectHop = async (url) => {
      fetched.push(url);
      if (url === "https://example.com/start") {
        return { ok: true, status: 301, location: "https://cdn.example.com/ok" };
      }
      return { ok: true, status: 200 };
    };

    const result = await resolveUrlSafely("https://example.com/start", {
      lookup,
      hopFetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://cdn.example.com/ok");
    }
    expect(fetched[0]).toBe("https://example.com/start");
    expect(fetched[1]).toBe("https://cdn.example.com/ok");
  });
});
