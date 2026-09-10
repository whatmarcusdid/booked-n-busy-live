import { POST } from "@/app/api/v1/audits/[token]/email/route";
import { requestReportEmail } from "@/lib/email/service";
import { resetRateLimitForTests } from "@/lib/http/rate-limit";
import { NextRequest } from "next/server";

jest.mock("@/lib/email/service", () => {
  const actual = jest.requireActual("@/lib/email/service");
  return {
    ...actual,
    requestReportEmail: jest.fn(),
  };
});

const mockRequest = requestReportEmail as jest.MockedFunction<
  typeof requestReportEmail
>;

describe("POST /api/v1/audits/{token}/email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitForTests();
  });

  it("returns 202 for an explicit email request", async () => {
    mockRequest.mockResolvedValue({
      ok: true,
      deliveryId: "del-1",
      status: "sent",
      duplicate: false,
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/v1/audits/tok/email", {
        method: "POST",
        body: JSON.stringify({ email: "owner@example.com" }),
      }),
      { params: Promise.resolve({ token: "tok" }) },
    );
    const data = await response.json();
    expect(response.status).toBe(202);
    expect(data).toEqual({
      deliveryId: "del-1",
      status: "sent",
      duplicate: false,
    });
  });

  it("does not distinguish invalid email from unknown token", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/v1/audits/tok/email", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email" }),
      }),
      { params: Promise.resolve({ token: "tok" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Email request not available" });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
