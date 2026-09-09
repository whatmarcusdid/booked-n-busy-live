import { readFileSync } from "fs";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { BOOK_FINDINGS_CALL_LABEL } from "@/app/book-findings-call";
import {
  BOOKING_SESSION_CREATED_EVENT,
  createBookingSession,
  type BookingAuditRef,
  type BookingSessionStore,
} from "@/lib/booking/session";
import { hmacSha256 } from "@/lib/crypto";

const STATUS_TOKEN = "s".repeat(64);
const REPORT_TOKEN_HASH = "r".repeat(64);

const REF: BookingAuditRef = {
  auditId: "audit-1",
  leadId: "lead-1",
  customerEmailHash: "email-hash-1",
};

function memoryStore(overrides: Partial<BookingSessionStore> = {}) {
  const rows: BookingAuditRef[] = [];
  const events: Array<{ auditId: string; eventType: string }> = [];

  const store: BookingSessionStore & {
    rows: typeof rows;
    events: typeof events;
  } = {
    rows,
    events,
    async findByStatusTokenHash(tokenHash) {
      return tokenHash === hmacSha256(STATUS_TOKEN) ? REF : null;
    },
    async findByReportTokenHash(tokenHash) {
      return tokenHash === REPORT_TOKEN_HASH ? REF : null;
    },
    async insert(ref) {
      const existing = rows.find((row) => row.auditId === ref.auditId);
      if (existing) {
        return {
          session: {
            id: "session-1",
            auditId: ref.auditId,
            leadId: ref.leadId,
            customerEmailHash: ref.customerEmailHash,
            createdAt: "2026-09-08T00:00:00.000Z",
          },
          duplicate: true,
        };
      }
      rows.push(ref);
      return {
        session: {
          id: "session-1",
          auditId: ref.auditId,
          leadId: ref.leadId,
          customerEmailHash: ref.customerEmailHash,
          createdAt: "2026-09-08T00:00:00.000Z",
        },
        duplicate: false,
      };
    },
    async recordEvent(auditId, eventType) {
      events.push({ auditId, eventType });
    },
    ...overrides,
  };
  return store;
}

describe("booking session creation", () => {
  it("records audit, lead, customer, and creation time", async () => {
    const store = memoryStore();
    const result = await createBookingSession(
      { statusToken: STATUS_TOKEN },
      store,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      auditId: "audit-1",
      leadId: "lead-1",
      customerEmailHash: "email-hash-1",
    });
    expect(result.session.createdAt).toBeTruthy();
  });

  it("authorizes the live session by its status token", async () => {
    const store = memoryStore();
    const result = await createBookingSession(
      { statusToken: STATUS_TOKEN },
      store,
    );
    expect(result.ok).toBe(true);
  });

  it("authorizes an emailed-report visitor by the exchanged cookie", async () => {
    const store = memoryStore();
    const result = await createBookingSession(
      { reportTokenHash: REPORT_TOKEN_HASH },
      store,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses when neither credential resolves an audit", async () => {
    const store = memoryStore();
    expect(
      await createBookingSession({ statusToken: "wrong" }, store),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await createBookingSession({}, store)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("is idempotent: a double-clicked CTA yields one session and one event", async () => {
    const store = memoryStore();
    const first = await createBookingSession({ statusToken: STATUS_TOKEN }, store);
    const second = await createBookingSession({ statusToken: STATUS_TOKEN }, store);

    expect(first.ok && first.duplicate).toBe(false);
    expect(second.ok && second.duplicate).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(
      store.events.filter((e) => e.eventType === BOOKING_SESSION_CREATED_EVENT),
    ).toHaveLength(1);
  });

  it("captures the booking-session-creation event", async () => {
    const store = memoryStore();
    await createBookingSession({ statusToken: STATUS_TOKEN }, store);
    expect(store.events).toEqual([
      { auditId: "audit-1", eventType: BOOKING_SESSION_CREATED_EVENT },
    ]);
  });
});

describe("results page has exactly one CTA", () => {
  const surfaces = [
    "app/report/page.tsx",
    "app/audit/results/[token]/page.tsx",
  ];

  it("uses the approved label", () => {
    expect(BOOK_FINDINGS_CALL_LABEL).toBe("Book your findings call");
  });

  it("renders one action and no competing CTAs", () => {
    for (const path of surfaces) {
      const source = readFileSync(path, "utf8");
      const ctas = source.match(/<BookFindingsCall/g) ?? [];
      expect(ctas).toHaveLength(1);

      // The competing actions this decision removed. Checked as actions —
      // an endpoint call or a second button — rather than as words, since
      // the expired-link state legitimately asks for an email address.
      expect(source).not.toMatch(/Schedule a walkthrough/i);
      expect(source).not.toContain("/email");
      expect(source).not.toMatch(/tier a/i);
      expect(source).not.toMatch(/purchase|buy now/i);
      expect(source.match(/<MdFilledButton|<button/g) ?? []).toHaveLength(0);
    }
  });

  it("has no leftover results view offering another action", () => {
    // The old client-side report view carried a second CTA and was replaced
    // by the cookie-authorized server render.
    expect(() =>
      readFileSync("app/report/[reportToken]/report-view.tsx", "utf8"),
    ).toThrow();
  });

  it("the CTA itself renders a single button", () => {
    const cta = readFileSync("app/book-findings-call.tsx", "utf8");
    expect(cta.match(/<MdFilledButton/g) ?? []).toHaveLength(1);
    expect(cta).not.toContain("/email");
  });

  it("captures view, click, and creation in analytics", () => {
    const cta = readFileSync("app/book-findings-call.tsx", "utf8");
    expect(cta).toContain("resultsCtaViewed");
    expect(cta).toContain("resultsCtaClicked");
    expect(cta).toContain("bookingSessionCreated");
    expect(ANALYTICS_EVENTS.resultsCtaViewed).toBe("results_cta_viewed");
    expect(ANALYTICS_EVENTS.resultsCtaClicked).toBe("results_cta_clicked");
    expect(ANALYTICS_EVENTS.bookingSessionCreated).toBe(
      "booking_session_created",
    );
  });

  it("redirects to prepare with the status token after a successful booking", () => {
    const cta = readFileSync("app/book-findings-call.tsx", "utf8");
    expect(cta).toContain("`/audit/prepare/${statusToken}`");
    expect(cta).not.toMatch(
      /window\.location\.assign\(\s*json\.scheduleUrl\s*\)/,
    );
    expect(cta).toContain('"/api/v1/booking-sessions"');
  });

  it("posts to /report/booking-sessions when no statusToken is present", () => {
    const cta = readFileSync("app/book-findings-call.tsx", "utf8");
    expect(cta).toContain("REPORT_BOOKING_SESSIONS_PATH");
    expect(cta).toMatch(
      /statusToken\s*\?\s*"\/api\/v1\/booking-sessions"\s*:\s*REPORT_BOOKING_SESSIONS_PATH/,
    );
    expect(cta).toContain("REPORT_PREPARE_PATH");
  });

  it("sends cookie-auth /report visitors to /report/prepare, not /schedule", () => {
    const cta = readFileSync("app/book-findings-call.tsx", "utf8");
    expect(cta).toContain("REPORT_PREPARE_PATH");
    expect(cta).not.toMatch(
      /statusToken \? `\/audit\/prepare\/\$\{statusToken\}` : json\.scheduleUrl/,
    );
  });
});

describe("report email stays independent of the CTA", () => {
  it("delivery is not triggered by any results-page action", () => {
    const cta = readFileSync("app/book-findings-call.tsx", "utf8");
    const requests = cta.match(/fetch\([^)]+/g) ?? [];
    expect(requests).toHaveLength(1);
    expect(cta).toContain('"/api/v1/booking-sessions"');
    expect(cta).toContain("REPORT_BOOKING_SESSIONS_PATH");
    expect(cta).not.toContain("/email");

    // And booking creation cannot send an email.
    const session = readFileSync("lib/booking/session.ts", "utf8");
    expect(session).not.toContain("requestReportEmail");
    expect(session).not.toContain("provider.send");
  });
});
