import {
  ADMIN_AUTH_GENERIC,
  isAdminEmailAllowed,
  readAdminSession,
  signAdminSession,
} from "@/lib/admin/auth";
import { requestAdminMagicLink } from "@/lib/admin/service";
import type { TransactionalEmailProvider } from "@/lib/email/provider";

describe("admin magic-link auth", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_ALLOWED_EMAILS = "marcus@example.com";
  });

  afterAll(() => {
    process.env.ADMIN_ALLOWED_EMAILS = previous;
  });

  it("allows only configured emails", () => {
    expect(isAdminEmailAllowed("marcus@example.com")).toBe(true);
    expect(isAdminEmailAllowed("other@example.com")).toBe(false);
  });

  it("round-trips a signed session cookie", () => {
    const exp = Date.now() + 60_000;
    const value = signAdminSession({ email: "marcus@example.com", exp });
    expect(readAdminSession(value)?.email).toBe("marcus@example.com");
    expect(readAdminSession(value, exp + 1)).toBeNull();
    expect(readAdminSession("tampered")).toBeNull();
  });

  it("does not send mail for an email outside the allow-list", async () => {
    const send = jest.fn();
    const provider: TransactionalEmailProvider = { send };
    await requestAdminMagicLink({
      email: "other@example.com",
      allowed: false,
      provider,
      store: { async insertMagicLink() {} },
      origin: "http://localhost:3000",
    });
    expect(send).not.toHaveBeenCalled();
    expect(ADMIN_AUTH_GENERIC.message).toMatch(/If that email is allowed/);
  });

  it("sends a link when the email is allowed", async () => {
    const send = jest.fn(async () => ({ ok: true as const, providerMessageId: "1" }));
    const insertMagicLink = jest.fn(async () => undefined);
    await requestAdminMagicLink({
      email: "marcus@example.com",
      allowed: true,
      provider: { send },
      store: { insertMagicLink },
      origin: "http://localhost:3000",
    });
    expect(insertMagicLink).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "marcus@example.com" }),
    );
  });
});
