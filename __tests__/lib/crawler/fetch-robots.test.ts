import { fetchRobotsOverHttp } from "@/lib/crawler/fetch-robots";
import type { ProbeRedirectHop } from "@/lib/url-safety";

const PUBLIC_IP = "93.184.216.34";
const lookup = async () => [PUBLIC_IP];

function textResponse(body: string, status = 200, headers?: HeadersInit) {
  return new Response(body, { status, headers });
}

describe("robots.txt redirect revalidation", () => {
  it("rejects a redirect to an unsafe destination instead of following it", async () => {
    const fetchImpl = jest.fn(async () => textResponse("User-agent: *\nAllow: /"));
    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url.includes("example.com")) {
        return { ok: true, status: 302, location: "http://127.0.0.1/robots.txt" };
      }
      throw new Error(`must not fetch ${url}`);
    };

    const result = await fetchRobotsOverHttp({
      url: "https://example.com/robots.txt",
      timeoutMs: 5000,
      safetyDeps: { lookup, hopFetch },
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BLOCKED_ADDRESS");
      expect(result.rejectedUrl).toContain("127.0.0.1");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not follow a body-GET redirect to a private IP", async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes("127.0.0.1")) {
        throw new Error("must not follow to loopback");
      }
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/robots.txt" },
      });
    });

    const result = await fetchRobotsOverHttp({
      url: "https://example.com/robots.txt",
      timeoutMs: 5000,
      safetyDeps: { lookup },
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BLOCKED_ADDRESS");
    }
    expect(
      fetchImpl.mock.calls.some(([url]) => String(url).includes("127.0.0.1")),
    ).toBe(false);
  });

  it("fetches robots.txt from the validated destination of a safe redirect", async () => {
    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url === "https://example.com/robots.txt") {
        return {
          ok: true,
          status: 301,
          location: "https://cdn.example.com/robots.txt",
        };
      }
      return { ok: true, status: 200 };
    };
    const fetchImpl = jest.fn(async (url: string) => {
      expect(String(url)).toBe("https://cdn.example.com/robots.txt");
      return textResponse("User-agent: *\nDisallow: /admin/\n");
    });

    const result = await fetchRobotsOverHttp({
      url: "https://example.com/robots.txt",
      timeoutMs: 5000,
      safetyDeps: { lookup, hopFetch },
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      body: "User-agent: *\nDisallow: /admin/\n",
      httpStatus: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
