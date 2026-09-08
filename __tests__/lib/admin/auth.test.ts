import {
  ADMIN_AUTH_GENERIC,
  adminPublicOrigin,
  hashAdminEmail,
  isAdminEmailAllowed,
  padToMinimumElapsed,
  readAdminSession,
  signAdminSession,
} from "@/lib/admin/auth";
import { requestAdminMagicLink } from "@/lib/admin/service";
import { createResendProvider } from "@/lib/email/resend";
import type { TransactionalEmailProvider } from "@/lib/email/provider";

const ALLOWED_EMAIL = "marcus@example.com";
const DENIED_EMAIL = "other@example.com";

function loggedText(
  ...spies: Array<jest.SpiedFunction<typeof console.info>>
): string {
  return spies.flatMap((spy) => spy.mock.calls).map((args) => JSON.stringify(args)).join("\n");
}

describe("admin magic-link auth", () => {
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

  it("pads only the remaining time up to the minimum", async () => {
    const sleep = jest.fn(async () => undefined);
    await padToMinimumElapsed(1_000, 250, 1_180, sleep);
    expect(sleep).toHaveBeenCalledWith(70);
    await padToMinimumElapsed(1_000, 250, 1_400, sleep);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("maps 127.0.0.1 request origins to localhost for emailed links", () => {
    expect(adminPublicOrigin("http://127.0.0.1:3000")).toBe(
      "http://localhost:3000",
    );
    expect(adminPublicOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("prefers ADMIN_APP_ORIGIN when set", () => {
    process.env.ADMIN_APP_ORIGIN = "https://admin.example.test/";
    expect(adminPublicOrigin("http://127.0.0.1:3000")).toBe(
      "https://admin.example.test",
    );
    delete process.env.ADMIN_APP_ORIGIN;
  });

  it("allows only configured emails", () => {
    expect(isAdminEmailAllowed(ALLOWED_EMAIL)).toBe(true);
    expect(isAdminEmailAllowed(DENIED_EMAIL)).toBe(false);
  });

  it("round-trips a signed session cookie", () => {
    const exp = Date.now() + 60_000;
    const value = signAdminSession({ email: ALLOWED_EMAIL, exp });
    expect(readAdminSession(value)?.email).toBe(ALLOWED_EMAIL);
    expect(readAdminSession(value, exp + 1)).toBeNull();
    expect(readAdminSession("tampered")).toBeNull();
  });

  it("does not send mail for an email outside the allow-list", async () => {
    const send = jest.fn();
    const provider: TransactionalEmailProvider = { send };
    await requestAdminMagicLink({
      email: DENIED_EMAIL,
      allowed: false,
      provider,
      store: { async insertMagicLink() {} },
      origin: "http://localhost:3000",
    });
    expect(send).not.toHaveBeenCalled();
    expect(ADMIN_AUTH_GENERIC.message).toMatch(/If that email is allowed/);
    expect(info).toHaveBeenCalledWith(
      "admin magic-link: email not on allow-list",
      { emailHash: hashAdminEmail(DENIED_EMAIL) },
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(loggedText(info, warn, error)).not.toContain(DENIED_EMAIL);
  });

  it("warns when ADMIN_ALLOWED_EMAILS is unset", async () => {
    delete process.env.ADMIN_ALLOWED_EMAILS;
    const send = jest.fn();
    await requestAdminMagicLink({
      email: ALLOWED_EMAIL,
      allowed: false,
      provider: { send },
      store: { async insertMagicLink() {} },
      origin: "http://localhost:3000",
    });
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "admin magic-link: ADMIN_ALLOWED_EMAILS is unset",
      { emailHash: hashAdminEmail(ALLOWED_EMAIL) },
    );
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(loggedText(info, warn, error)).not.toContain(ALLOWED_EMAIL);
  });

  it("sends a link when the email is allowed", async () => {
    const send = jest.fn(async () => ({ ok: true as const, providerMessageId: "1" }));
    const insertMagicLink = jest.fn(async () => undefined);
    await requestAdminMagicLink({
      email: ALLOWED_EMAIL,
      allowed: true,
      provider: { send },
      store: { insertMagicLink },
      origin: "http://localhost:3000",
    });
    expect(insertMagicLink).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ALLOWED_EMAIL }),
    );
    const emailHash = hashAdminEmail(ALLOWED_EMAIL);
    expect(info).toHaveBeenCalledWith("admin magic-link: row inserted", {
      emailHash,
    });
    expect(info).toHaveBeenCalledWith(
      "admin magic-link: provider send succeeded",
      { emailHash },
    );
    expect(error).not.toHaveBeenCalled();
    expect(loggedText(info, warn, error)).not.toContain(ALLOWED_EMAIL);
    expect(loggedText(info, warn, error)).not.toMatch(/token=/);
  });

  it("logs an error when Resend is not configured", async () => {
    const insertMagicLink = jest.fn(async () => undefined);
    await requestAdminMagicLink({
      email: ALLOWED_EMAIL,
      allowed: true,
      provider: createResendProvider(),
      store: { insertMagicLink },
      origin: "http://localhost:3000",
    });
    expect(insertMagicLink).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "admin magic-link: provider send failed",
      {
        emailHash: hashAdminEmail(ALLOWED_EMAIL),
        error: "Resend is not configured.",
      },
    );
    expect(loggedText(info, warn, error)).not.toContain(ALLOWED_EMAIL);
    expect(loggedText(info, warn, error)).not.toMatch(/token=/);
  });
});
