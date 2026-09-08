import { createResendProvider } from "@/lib/email/resend";

describe("Resend provider", () => {
  it("sends with the Idempotency-Key header and does not log the API key", async () => {
    const fetchImpl = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>(
      async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    );

    const provider = createResendProvider({
      apiKey: "test-key",
      from: "reports@example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.send({
      to: "owner@example.com",
      subject: "TEST diagnostic email — ignore",
      text: "test",
      html: "<p>test</p>",
      idempotencyKey: "audit-1:rev-1:report_ready",
    });

    expect(result).toEqual({ ok: true, providerMessageId: "re_123" });
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("audit-1:rev-1:report_ready");
    expect(JSON.stringify(init?.body)).not.toContain("test-key");
  });

  it("fails closed when Resend is not configured", async () => {
    const provider = createResendProvider({ apiKey: "", from: "" });
    const result = await provider.send({
      to: "owner@example.com",
      subject: "x",
      text: "x",
      html: "x",
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(false);
  });
});
