import { GET } from "@/app/api/v1/admin/auth/callback/route";
import { consumeAdminMagicLink } from "@/lib/admin/service";
import { NextRequest } from "next/server";

jest.mock("@/lib/admin/service", () => {
  const actual = jest.requireActual("@/lib/admin/service");
  return {
    ...actual,
    consumeAdminMagicLink: jest.fn(),
    createSupabaseAdminStore: () => ({}),
  };
});

const mockConsume = consumeAdminMagicLink as jest.MockedFunction<
  typeof consumeAdminMagicLink
>;

describe("GET /api/v1/admin/auth/callback", () => {
  beforeEach(() => {
    mockConsume.mockReset();
  });

  it("redirects to /admin with a clear error when the token is missing or used", async () => {
    mockConsume.mockResolvedValue(null);
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/v1/admin/auth/callback?token=dead",
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/admin?error=invalid_or_expired",
    );
  });
});
