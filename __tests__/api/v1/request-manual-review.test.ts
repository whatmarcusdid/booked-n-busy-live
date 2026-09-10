import { POST } from "@/app/api/v1/audits/[token]/request-manual-review/route";
import { resetRateLimitForTests } from "@/lib/http/rate-limit";
import { requestManualReview } from "@/lib/services/manual-review";
import { NextRequest } from "next/server";

jest.mock("@/lib/services/manual-review", () => {
  const actual = jest.requireActual("@/lib/services/manual-review");
  return {
    ...actual,
    requestManualReview: jest.fn(),
    createSupabaseManualReviewStore: () => ({}),
  };
});

const mockRequest = requestManualReview as jest.MockedFunction<
  typeof requestManualReview
>;

function post(token: string) {
  return POST(
    new NextRequest(
      `http://localhost:3000/api/v1/audits/${token}/request-manual-review`,
      { method: "POST" },
    ),
    { params: Promise.resolve({ token }) },
  );
}

describe("POST /api/v1/audits/{token}/request-manual-review", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitForTests();
  });

  it("returns success when the event is written", async () => {
    mockRequest.mockResolvedValue({ ok: true, alreadyRequested: false });
    const response = await post("status-token");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      alreadyRequested: false,
    });
  });

  it("returns success without a second send when already requested", async () => {
    mockRequest.mockResolvedValue({ ok: true, alreadyRequested: true });
    const response = await post("status-token");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      alreadyRequested: true,
    });
  });

  it("returns a generic 404 for a non-failed audit", async () => {
    mockRequest.mockResolvedValue({ ok: false, reason: "not_failed" });
    const response = await post("status-token");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Request not available" });
  });
});
