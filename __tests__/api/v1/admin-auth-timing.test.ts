import { POST } from "@/app/api/v1/admin/auth/request/route";
import { ADMIN_AUTH_GENERIC } from "@/lib/admin/auth";
import { NextRequest } from "next/server";

jest.mock("@/lib/admin/service", () => {
  const actual = jest.requireActual("@/lib/admin/service");
  return {
    ...actual,
    createSupabaseAdminStore: () => ({
      insertMagicLink: jest.fn(async () => undefined),
    }),
  };
});

const ALLOWED_EMAIL = "marcus@example.com";
const DENIED_EMAIL = "other@example.com";

function request(email: string) {
  return new NextRequest("http://localhost:3000/api/v1/admin/auth/request", {
    method: "POST",
    body: JSON.stringify({ email }),
    headers: { "Content-Type": "application/json" },
  });
}

async function timed(email: string): Promise<number> {
  const started = Date.now();
  const response = await POST(request(email));
  const elapsed = Date.now() - started;
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(ADMIN_AUTH_GENERIC);
  return elapsed;
}

describe("POST /api/v1/admin/auth/request timing", () => {
  const previousAllow = process.env.ADMIN_ALLOWED_EMAILS;
  const previousMin = process.env.ADMIN_AUTH_MIN_RESPONSE_MS;
  const previousResendKey = process.env.RESEND_API_KEY;
  const previousResendFrom = process.env.RESEND_FROM_EMAIL;

  beforeEach(() => {
    process.env.ADMIN_ALLOWED_EMAILS = ALLOWED_EMAIL;
    process.env.ADMIN_AUTH_MIN_RESPONSE_MS = "80";
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (previousAllow === undefined) delete process.env.ADMIN_ALLOWED_EMAILS;
    else process.env.ADMIN_ALLOWED_EMAILS = previousAllow;
    if (previousMin === undefined) delete process.env.ADMIN_AUTH_MIN_RESPONSE_MS;
    else process.env.ADMIN_AUTH_MIN_RESPONSE_MS = previousMin;
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
    if (previousResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousResendFrom;
  });

  it("keeps accepted and rejected responses within 50ms across runs", async () => {
    const diffs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const denied = await timed(DENIED_EMAIL);
      const allowed = await timed(ALLOWED_EMAIL);
      diffs.push(Math.abs(allowed - denied));
    }
    expect(Math.max(...diffs)).toBeLessThanOrEqual(50);
  });
});
