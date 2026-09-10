import { SUPPORT_EMAIL } from "@/lib/identity";
import {
  MANUAL_REVIEW_REQUESTED_EVENT,
  requestManualReview,
  type ManualReviewStore,
} from "@/lib/services/manual-review";
import type { TransactionalEmailProvider } from "@/lib/email/provider";

const AUDIT = {
  id: "audit-failed-1",
  currentState: "failed",
  websiteUrl: "https://www.bookednbusy.app/pricing",
};

function memoryStore(
  existing: { event: boolean } = { event: false },
): ManualReviewStore & {
  events: Array<{ auditId: string; eventType: string }>;
} {
  const events: Array<{ auditId: string; eventType: string }> = existing.event
    ? [{ auditId: AUDIT.id, eventType: MANUAL_REVIEW_REQUESTED_EVENT }]
    : [];
  return {
    events,
    async findAuditByStatusToken(statusToken) {
      if (statusToken !== "status-token") return null;
      return AUDIT;
    },
    async hasManualReviewEvent(auditId) {
      return events.some(
        (row) =>
          row.auditId === auditId &&
          row.eventType === MANUAL_REVIEW_REQUESTED_EVENT,
      );
    },
    async insertManualReviewEvent(auditId, eventData) {
      events.push({
        auditId,
        eventType: MANUAL_REVIEW_REQUESTED_EVENT,
      });
      expect(eventData.domain).toBe("bookednbusy.app");
    },
  };
}

function capturingProvider(): TransactionalEmailProvider & {
  sent: Array<{ to: string; subject: string; text: string }>;
} {
  const provider = {
    sent: [] as Array<{ to: string; subject: string; text: string }>,
    async send(input: { to: string; subject: string; text: string }) {
      provider.sent.push({
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return { ok: true as const, providerMessageId: `re_${provider.sent.length}` };
    },
  };
  return provider;
}

describe("requestManualReview", () => {
  it("writes the event once and emails support with audit id and domain", async () => {
    const store = memoryStore();
    const provider = capturingProvider();
    const result = await requestManualReview({
      statusToken: "status-token",
      store,
      provider,
    });
    expect(result).toEqual({ ok: true, alreadyRequested: false });
    expect(store.events).toHaveLength(1);
    expect(store.events[0].eventType).toBe(MANUAL_REVIEW_REQUESTED_EVENT);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].to).toBe(SUPPORT_EMAIL);
    expect(provider.sent[0].text).toContain(AUDIT.id);
    expect(provider.sent[0].text).toContain("bookednbusy.app");
    expect(provider.sent[0].text).not.toMatch(/@(?!bookednbusy\.app)/);
  });

  it("is idempotent: a second call does not send another email", async () => {
    const store = memoryStore();
    const provider = capturingProvider();
    await requestManualReview({
      statusToken: "status-token",
      store,
      provider,
    });
    const second = await requestManualReview({
      statusToken: "status-token",
      store,
      provider,
    });
    expect(second).toEqual({ ok: true, alreadyRequested: true });
    expect(store.events).toHaveLength(1);
    expect(provider.sent).toHaveLength(1);
  });

  it("rejects a non-failed audit without writing or sending", async () => {
    const store = memoryStore();
    store.findAuditByStatusToken = async () => ({
      ...AUDIT,
      currentState: "unsupported",
    });
    const provider = capturingProvider();
    const result = await requestManualReview({
      statusToken: "status-token",
      store,
      provider,
    });
    expect(result).toEqual({ ok: false, reason: "not_failed" });
    expect(store.events).toHaveLength(0);
    expect(provider.sent).toHaveLength(0);
  });
});
