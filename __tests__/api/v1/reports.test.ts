import { GET } from "@/app/api/v1/reports/[reportToken]/route";
import { resetRateLimitForTests } from "@/lib/http/rate-limit";
import { getPublicReport } from "@/lib/reports/public-report";
import { NextRequest } from "next/server";

jest.mock("@/lib/reports/public-report", () => {
  const actual = jest.requireActual("@/lib/reports/public-report");
  return {
    ...actual,
    getPublicReport: jest.fn(),
  };
});

const mockGet = getPublicReport as jest.MockedFunction<typeof getPublicReport>;

function request(token: string, ip = "203.0.113.10") {
  return {
    request: new NextRequest(`http://localhost:3000/api/v1/reports/${token}`, {
      headers: { "x-forwarded-for": ip },
    }),
    context: { params: Promise.resolve({ reportToken: token }) },
  };
}

describe("GET /api/v1/reports/{reportToken}", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitForTests();
  });

  it("returns a published report with no-store headers", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      report: {
        websiteUrl: "https://example.com",
        businessName: "Example",
        overallScore: 0.8,
        executiveSummary: "Summary",
        publicationStatus: "published",
        publishedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
        pillars: [],
        recommendations: [],
      },
    });

    const { request: req, context } = request("valid-token");
    const response = await GET(req, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.publicationStatus).toBe("published");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it.each(["missing", "review", "approved", "revoked", "expired"] as const)(
    "returns the identical not-available body for %s",
    async (label) => {
      mockGet.mockResolvedValue({ ok: false });
      const { request: req, context } = request(`token-${label}`, `203.0.113.${label.length}`);
      const response = await GET(req, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "Report not available" });
      expect(data).not.toHaveProperty("code");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    },
  );

  it("does not distinguish empty tokens from unknown tokens", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/v1/reports/"),
      { params: Promise.resolve({ reportToken: "" }) },
    );
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data).toEqual({ error: "Report not available" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rate-limits repeated guesses from the same client", async () => {
    mockGet.mockResolvedValue({ ok: false });
    let last = { status: 0, body: {} as Record<string, unknown> };
    for (let i = 0; i < 31; i += 1) {
      const { request: req, context } = request(`guess-${i}`);
      const response = await GET(req, context);
      last = { status: response.status, body: await response.json() };
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe("Too many requests");
  });
});
