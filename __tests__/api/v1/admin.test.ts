import { GET } from "@/app/api/v1/admin/audits/route";
import { POST as publish } from "@/app/api/v1/admin/audits/[id]/publish/route";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "@/lib/admin/auth";
import { publishAdminReport } from "@/lib/admin/service";
import { NextRequest } from "next/server";

jest.mock("@/lib/admin/service", () => {
  const actual = jest.requireActual("@/lib/admin/service");
  return {
    ...actual,
    createSupabaseAdminStore: () => ({
      listAudits: jest.fn(async () => ({ items: [], total: 0 })),
    }),
    publishAdminReport: jest.fn(),
  };
});

const mockPublish = publishAdminReport as jest.MockedFunction<
  typeof publishAdminReport
>;

function authed(url: string, method = "GET", body?: unknown) {
  const expires = Date.now() + 60_000;
  const request = new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
  request.cookies.set(
    ADMIN_SESSION_COOKIE,
    signAdminSession({ email: "marcus@example.com", exp: expires }),
  );
  return request;
}

describe("admin API auth + publish", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_ALLOWED_EMAILS = "marcus@example.com";
  });

  afterAll(() => {
    process.env.ADMIN_ALLOWED_EMAILS = previous;
  });

  it("rejects the queue without a session", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/v1/admin/audits"),
    );
    expect(response.status).toBe(401);
  });

  it("lists audits when signed in", async () => {
    const response = await GET(
      authed("http://localhost:3000/api/v1/admin/audits"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
  });

  it("publish route is the HTTP caller of publishAdminReport", async () => {
    mockPublish.mockResolvedValue({
      ok: true,
      token: "tok",
      expiresAt: "2026-10-08T00:00:00.000Z",
    });
    const response = await publish(
      authed("http://localhost:3000/api/v1/admin/audits/a1/publish", "POST", {}),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(response.status).toBe(200);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ auditId: "a1", reviewerEmail: "marcus@example.com" }),
    );
  });
});
