import { POST } from "@/app/api/v1/audits/[token]/service-mix/route";
import { resetRateLimitForTests } from "@/lib/http/rate-limit";
import { saveLeadServiceMix } from "@/lib/leads/service-mix";
import { NextRequest } from "next/server";

jest.mock("@/lib/leads/service-mix", () => {
  const actual = jest.requireActual("@/lib/leads/service-mix");
  return {
    ...actual,
    saveLeadServiceMix: jest.fn(),
  };
});

const mockSave = saveLeadServiceMix as jest.MockedFunction<
  typeof saveLeadServiceMix
>;

function post(token: string, body: unknown) {
  return POST(
    new NextRequest(
      `http://localhost:3000/api/v1/audits/${token}/service-mix`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ token }) },
  );
}

describe("POST /api/v1/audits/{token}/service-mix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitForTests();
  });

  it("saves a valid chip selection for the token in the URL", async () => {
    mockSave.mockResolvedValue({ ok: true });
    const response = await post("status-token", { selection: "plumbing" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockSave).toHaveBeenCalledWith("status-token", "plumbing");
  });

  it("rejects a tampered selection without calling through a lead id", async () => {
    const response = await post("status-token", {
      selection: "franchise",
      leadId: "some-other-lead",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("does not accept a client-supplied lead id as the target", async () => {
    mockSave.mockResolvedValue({ ok: true });
    await post("status-token", {
      selection: "plumbing",
      leadId: "attacker-lead",
    });
    expect(mockSave).toHaveBeenCalledWith("status-token", "plumbing");
    expect(mockSave.mock.calls[0]).not.toEqual(
      expect.arrayContaining(["attacker-lead"]),
    );
  });

  it("returns a generic 404 when the token is unknown", async () => {
    mockSave.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await post("missing-token", { selection: "plumbing" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not available" });
  });
});
