import { POST } from "@/app/api/v1/admin/auth/request/route";
import { ADMIN_AUTH_GENERIC, hashAdminEmail } from "@/lib/admin/auth";
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

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/admin/auth/request", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/v1/admin/auth/request logging", () => {
  const previousAllow = process.env.ADMIN_ALLOWED_EMAILS;
  const previousResendKey = process.env.RESEND_API_KEY;
  const previousResendFrom = process.env.RESEND_FROM_EMAIL;
  let info: jest.SpiedFunction<typeof console.info>;
  let warn: jest.SpiedFunction<typeof console.warn>;
  let error: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    process.env.ADMIN_ALLOWED_EMAILS = ALLOWED_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  afterAll(() => {
    if (previousAllow === undefined) delete process.env.ADMIN_ALLOWED_EMAILS;
    else process.env.ADMIN_ALLOWED_EMAILS = previousAllow;
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
    if (previousResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousResendFrom;
  });

  it("returns the generic 200 and errors when RESEND_API_KEY is missing", async () => {
    const response = await POST(request({ email: ALLOWED_EMAIL }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ADMIN_AUTH_GENERIC);
    expect(error).toHaveBeenCalledWith(
      "admin magic-link: provider send failed",
      {
        emailHash: hashAdminEmail(ALLOWED_EMAIL),
        error: "Resend is not configured.",
      },
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(ALLOWED_EMAIL);
    expect(logged).not.toMatch(/token=/);
  });

  it("returns the generic 200 and warns when ADMIN_ALLOWED_EMAILS is unset", async () => {
    delete process.env.ADMIN_ALLOWED_EMAILS;
    const response = await POST(request({ email: ALLOWED_EMAIL }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ADMIN_AUTH_GENERIC);
    expect(warn).toHaveBeenCalledWith(
      "admin magic-link: ADMIN_ALLOWED_EMAILS is unset",
      { emailHash: hashAdminEmail(ALLOWED_EMAIL) },
    );
    expect(error).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ALLOWED_EMAIL);
  });
});
