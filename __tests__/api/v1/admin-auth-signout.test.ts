import { POST } from "@/app/api/v1/admin/auth/signout/route";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "@/lib/admin/auth";
import { NextRequest } from "next/server";

describe("POST /api/v1/admin/auth/signout", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_ALLOWED_EMAILS = "marcus@example.com";
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.ADMIN_ALLOWED_EMAILS;
    else process.env.ADMIN_ALLOWED_EMAILS = previous;
  });

  it("clears the admin session cookie and redirects to /admin", async () => {
    const expires = Date.now() + 60_000;
    const request = new NextRequest(
      "http://localhost:3000/api/v1/admin/auth/signout",
      { method: "POST" },
    );
    request.cookies.set(
      ADMIN_SESSION_COOKIE,
      signAdminSession({ email: "marcus@example.com", exp: expires }),
    );

    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/admin",
    );
    const cleared = response.cookies.get(ADMIN_SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});
