import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingScreen } from "@/app/audit/status/[token]/loading-screen";
import { TradeChips } from "@/app/audit/status/[token]/trade-chips";
import {
  SERVICE_MIX_CHIPS,
  SERVICE_MIX_HEADING,
  SERVICE_MIX_QUESTION,
} from "@/lib/copy/audit-service-mix";
import { resolveLoadingView, WAIT_CARD } from "@/lib/copy/audit-progress";
import type { AuditStatusResponse } from "@/lib/schemas/audit-status";

const SCREEN = join(
  process.cwd(),
  "app/audit/status/[token]/loading-screen.tsx",
);
const CHIPS = join(process.cwd(), "app/audit/status/[token]/trade-chips.tsx");
const CSS = join(process.cwd(), "app/audit/status/[token]/audit-loading.css");

const STATUS: AuditStatusResponse = {
  auditId: "audit-1",
  status: "discovering",
  progress: {
    currentStep: "Mapping your website and discovering key pages…",
    percentage: 10,
  },
  websiteUrl: "https://mix.example",
  businessName: "Mix Co",
  submittedAt: "2026-09-13T00:00:00.000Z",
  elapsedMs: 1_000,
};

describe("wait-screen service-mix chips", () => {
  it("renders the five chips with no Skip and no Did you know", () => {
    expect(SERVICE_MIX_QUESTION).toBe("What's your primary trade?");
    const html = renderToStaticMarkup(createElement(TradeChips, { token: "tok" }));
    expect(html).toContain(SERVICE_MIX_HEADING);
    expect(html).toContain("your primary trade?");
    for (const chip of SERVICE_MIX_CHIPS) {
      expect(html).toContain(chip.label);
    }
    expect(html).not.toMatch(/>Skip</);
    expect(html).not.toContain("Did you know");
    expect(html).not.toContain("Submit");
  });

  it("keeps chips below the wait-card slot in both normal and slow states", () => {
    const normal = resolveLoadingView({
      status: "discovering",
      elapsedMs: 0,
    });
    const slow = resolveLoadingView({
      status: "discovering",
      elapsedMs: 90_000,
    });
    expect(normal?.waitCard).toBeNull();
    expect(slow?.waitCard).toEqual(WAIT_CARD);

    const normalHtml = renderToStaticMarkup(
      createElement(LoadingScreen, {
        view: normal!,
        data: STATUS,
        token: "tok",
      }),
    );
    const slowHtml = renderToStaticMarkup(
      createElement(LoadingScreen, {
        view: slow!,
        data: { ...STATUS, elapsedMs: 90_000 },
        token: "tok",
      }),
    );

    expect(normalHtml).toContain('data-testid="service-mix"');
    expect(slowHtml).toContain('data-testid="service-mix"');
    expect(slowHtml.indexOf("audit-loading-wait")).toBeGreaterThan(-1);
    expect(slowHtml.indexOf("audit-loading-wait")).toBeLessThan(
      slowHtml.indexOf('data-testid="service-mix"'),
    );
    expect(normalHtml).not.toContain("Did you know");
    expect(slowHtml).not.toContain("Did you know");
  });

  it("styles default chips in subtle and selected chips in primary", () => {
    const css = readFileSync(CSS, "utf8");
    expect(css).toMatch(
      /\.audit-loading-chip \{[\s\S]*?border:\s*2px solid var\(--al-text-subtle\)/,
    );
    expect(css).toMatch(
      /\.audit-loading-chip \{[\s\S]*?color:\s*var\(--al-text-subtle\)/,
    );
    expect(css).toMatch(
      /\.audit-loading-chip\.is-selected \{[\s\S]*?border-color:\s*var\(--al-action-primary\)/,
    );
    expect(css).toMatch(
      /\.audit-loading-chip\.is-selected \{[\s\S]*?color:\s*var\(--al-action-primary\)/,
    );
  });

  it("posts only the service-mix route from the chip panel", () => {
    const chips = readFileSync(CHIPS, "utf8");
    expect(chips).toContain('method: "POST"');
    expect(chips).toContain("/api/v1/audits/${token}/service-mix");
    expect(chips).not.toContain("leadId");
    expect(chips).not.toContain("audit_focus");
    expect(readFileSync(SCREEN, "utf8")).toContain("<TradeChips token={token} />");
  });
});
