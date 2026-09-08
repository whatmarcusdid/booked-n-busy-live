import { hashEmail, hmacSha256 } from "@/lib/crypto";
import {
  applyEmailWebhookEvent,
  createMemoryEmailStore,
  requestReportEmail,
} from "@/lib/email/service";
import type { TransactionalEmailProvider } from "@/lib/email/provider";

const token = "status-token";
const email = "owner@example.com";

function seedStore() {
  return createMemoryEmailStore([
    {
      tokenHash: hmacSha256(token),
      auditId: "audit-1",
      leadEmailHash: hashEmail(email),
      consentReportDelivery: true,
      reportRevisionId: "rev-1",
      publicationStatus: "review_required",
    },
  ]);
}

describe("report email delivery", () => {
  it("queues then marks sent using the idempotency key", async () => {
    const store = seedStore();
    const provider: TransactionalEmailProvider = {
      async send(input) {
        expect(input.idempotencyKey).toBe("audit-1:rev-1:report_ready");
        return { ok: true, providerMessageId: "resend-1" };
      },
    };

    const first = await requestReportEmail({
      statusToken: token,
      email,
      provider,
      store,
    });
    expect(first).toMatchObject({ ok: true, status: "sent", duplicate: false });

    const second = await requestReportEmail({
      statusToken: token,
      email,
      provider,
      store,
    });
    expect(second).toMatchObject({ ok: true, duplicate: true, status: "sent" });
    expect(store.deliveries).toHaveLength(1);
  });

  it("returns the same not-available miss for unknown token or email mismatch", async () => {
    const store = seedStore();
    const provider: TransactionalEmailProvider = {
      async send() {
        throw new Error("should not send");
      },
    };
    const unknown = await requestReportEmail({
      statusToken: "nope",
      email,
      provider,
      store,
    });
    const mismatch = await requestReportEmail({
      statusToken: token,
      email: "other@example.com",
      provider,
      store,
    });
    expect(unknown).toEqual(mismatch);
    expect(unknown.ok).toBe(false);
  });

  it("dedupes webhook events by event id", async () => {
    const store = seedStore();
    const provider: TransactionalEmailProvider = {
      async send() {
        return { ok: true, providerMessageId: "resend-1" };
      },
    };
    await requestReportEmail({ statusToken: token, email, provider, store });

    const first = await applyEmailWebhookEvent({
      eventId: "evt-1",
      providerMessageId: "resend-1",
      type: "delivered",
      store,
    });
    const second = await applyEmailWebhookEvent({
      eventId: "evt-1",
      providerMessageId: "resend-1",
      type: "delivered",
      store,
    });
    expect(first).toBe("applied");
    expect(second).toBe("duplicate");
    expect(store.deliveries[0].status).toBe("delivered");
  });
});
