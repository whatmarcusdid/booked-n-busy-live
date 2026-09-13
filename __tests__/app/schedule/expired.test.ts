import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScheduleExpiredScreen } from "@/app/schedule/expired-screen";
import { resolveScheduleExpiredView } from "@/lib/booking/schedule-expired";
import {
  BACK_TO_REPORT_LABEL,
  SCHEDULE_CONSUMED_BODY,
  SCHEDULE_CONSUMED_HEADLINE,
  SCHEDULE_EXPIRED_BODY_WITH_REPORT,
  SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT,
  SCHEDULE_EXPIRED_HEADLINE,
  resultsPathForStatusToken,
  scheduleExpiredPath,
  supportConsumedRebookLabel,
  supportRebookLabel,
} from "@/lib/copy/schedule-expired";
import { SUPPORT_EMAIL } from "@/lib/identity";
import { SCHEDULE_PATH } from "@/lib/copy/pre-call";
import { signScheduleHandoffToken } from "@/lib/booking/schedule-handoff-token";

const PAGE = join(process.cwd(), "app/schedule/page.tsx");
const SCREEN = join(process.cwd(), "app/schedule/expired-screen.tsx");
const ROUTE = join(process.cwd(), "app/schedule/[token]/route.ts");
const ICON = join(process.cwd(), "public/schedule/schedule-icon.svg");

function renderScreen(
  view: Parameters<typeof ScheduleExpiredScreen>[0]["view"],
) {
  return renderToStaticMarkup(
    createElement(ScheduleExpiredScreen, { view }),
  ).replace(/&#x27;/g, "'");
}

describe("scheduleExpiredPath", () => {
  it("keeps a dead session's status token on the fallback URL", () => {
    expect(scheduleExpiredPath()).toBe(SCHEDULE_PATH);
    expect(scheduleExpiredPath("status-token")).toBe(
      "/schedule?token=status-token",
    );
  });
});

describe("resolveScheduleExpiredView", () => {
  it("is Branch A when a status token still loads the results report", async () => {
    const view = await resolveScheduleExpiredView("status-token", {
      loadResults: async () => ({ ok: true }),
    });
    expect(view).toEqual({
      kind: "report",
      reportHref: resultsPathForStatusToken("status-token"),
    });
  });

  it("is already-booked when the report resolves and consumed_at is set", async () => {
    const findByAuditId = jest.fn(async () => ({
      consumedAt: "2026-09-09T18:00:00.000Z",
    }));
    const view = await resolveScheduleExpiredView("status-token", {
      loadResults: async () => ({ ok: true, auditId: "audit-1" }),
      sessionLookup: { findByAuditId },
    });
    expect(findByAuditId).toHaveBeenCalledWith("audit-1");
    expect(view).toEqual({ kind: "booked" });
  });

  it("stays Branch A when consumed_at is null and the session is only expired", async () => {
    const view = await resolveScheduleExpiredView("status-token", {
      loadResults: async () => ({ ok: true, auditId: "audit-1" }),
      sessionLookup: {
        async findByAuditId() {
          return { consumedAt: null };
        },
      },
    });
    expect(view).toEqual({
      kind: "report",
      reportHref: resultsPathForStatusToken("status-token"),
    });
  });

  it("is Branch B when the token or report cannot resolve, even if a session is consumed", async () => {
    const missingToken = await resolveScheduleExpiredView(undefined, {
      loadResults: async () => {
        throw new Error("should not look up without a token");
      },
    });
    expect(missingToken).toEqual({ kind: "support" });

    const findByAuditId = jest.fn(async () => ({
      consumedAt: "2026-09-09T18:00:00.000Z",
    }));
    const unknown = await resolveScheduleExpiredView("guessed-token", {
      loadResults: async () => ({ ok: false, code: "NOT_FOUND" }),
      sessionLookup: { findByAuditId },
    });
    expect(unknown).toEqual({ kind: "support" });
    expect(findByAuditId).not.toHaveBeenCalled();
  });

  it("is Branch A when HMAC misses but a live signed handoff token names a resolvable audit", async () => {
    const auditId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const now = new Date("2026-09-13T05:00:00.000Z");
    const token = signScheduleHandoffToken({ auditId, now });
    const view = await resolveScheduleExpiredView(token, {
      now,
      loadResults: async () => ({ ok: false, code: "NOT_FOUND" }),
      loadByAuditId: async (id) => {
        expect(id).toBe(auditId);
        return { ok: true };
      },
      sessionLookup: {
        async findByAuditId() {
          return { consumedAt: null };
        },
      },
    });
    expect(view).toEqual({
      kind: "report",
      reportHref: resultsPathForStatusToken(token),
    });
  });

  it("is Branch B when the signed handoff token has expired", async () => {
    const token = signScheduleHandoffToken({
      auditId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      now: new Date("2026-09-13T04:50:00.000Z"),
    });
    const view = await resolveScheduleExpiredView(token, {
      now: new Date("2026-09-13T05:00:00.000Z"),
      loadResults: async () => ({ ok: false, code: "NOT_FOUND" }),
      loadByAuditId: async () => {
        throw new Error("must not load an audit from an expired handoff");
      },
    });
    expect(view).toEqual({ kind: "support" });
  });

  it("does not treat a lookup failure as a missing report", async () => {
    const view = await resolveScheduleExpiredView("status-token", {
      loadResults: async () => ({ ok: false, code: "SERVER_ERROR" }),
    });
    expect(view).toEqual({ kind: "error" });
  });
});

describe("ScheduleExpiredScreen", () => {
  it("renders Branch A with a valid-but-expired token whose report still resolves", () => {
    const html = renderScreen({
      kind: "report",
      reportHref: "/audit/results/status-token",
    });
    expect(html).toContain(SCHEDULE_EXPIRED_HEADLINE);
    expect(html).toContain(SCHEDULE_EXPIRED_BODY_WITH_REPORT);
    expect(html).toContain(BACK_TO_REPORT_LABEL);
    expect(html).toContain('href="/audit/results/status-token"');
    expect(html).toContain("/schedule/schedule-icon.svg");
    expect(html).not.toContain(SUPPORT_EMAIL);
    expect(html).not.toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
  });

  it("renders the already-booked variant when consumed_at is set", () => {
    const html = renderScreen({ kind: "booked" });
    expect(html).toContain(SCHEDULE_CONSUMED_HEADLINE);
    expect(html).toContain(SCHEDULE_CONSUMED_BODY);
    expect(html).toContain(supportConsumedRebookLabel(SUPPORT_EMAIL));
    expect(html).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(html).toContain("/schedule/schedule-icon.svg");
    expect(html).not.toContain(BACK_TO_REPORT_LABEL);
    expect(html).not.toContain("/audit/results/");
    expect(html).not.toContain(SCHEDULE_EXPIRED_BODY_WITH_REPORT);
    expect(html).not.toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
    expect(html).not.toContain("not able to pull up your report");
    expect(html).not.toContain(supportRebookLabel(SUPPORT_EMAIL));
    expect(html).not.toContain("schedule-expired-cta");
    expect(html).toContain("You've already got a findings call booked");
    expect(html).toContain("Email us at support@bookednbusy.app to reschedule");
  });

  it("renders Branch B when the token or report cannot resolve at all", () => {
    const html = renderScreen({ kind: "support" });
    expect(html).toContain(SCHEDULE_EXPIRED_HEADLINE);
    expect(html).toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
    expect(html).toContain(supportRebookLabel(SUPPORT_EMAIL));
    expect(html).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(html).not.toContain(BACK_TO_REPORT_LABEL);
    expect(html).not.toContain("/audit/results/");
  });
});

describe("schedule dead-end wiring", () => {
  it("looks up the report with loadAuditResults and reuses the results logo assets", () => {
    const page = readFileSync(PAGE, "utf8");
    const screen = readFileSync(SCREEN, "utf8");
    const route = readFileSync(ROUTE, "utf8");
    expect(page).toContain("resolveScheduleExpiredView");
    expect(page).toContain("searchParams");
    expect(screen).toContain("/audit/logo-mark.svg");
    expect(screen).toContain("/audit/wordmark.svg");
    expect(screen).toContain("/schedule/schedule-icon.svg");
    expect(route).toContain("scheduleExpiredPath(token)");
    expect(readFileSync(ICON, "utf8")).toContain('width="56"');
    const css = readFileSync(
      join(process.cwd(), "app/schedule/schedule-expired.css"),
      "utf8",
    );
    expect(css).toContain("letter-spacing: 0");
    expect(css).toContain("width: 56px");
    expect(css).toContain("height: 56px");
  });
});
