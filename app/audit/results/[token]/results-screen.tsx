import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/identity";
import {
  HOW_YOU_EARNED_HEADING,
  RECOMMENDED_IMPROVEMENTS_HEADING,
  SCHEDULE_CONSULTATION_LABEL,
  type ResultsPillarView,
  type ResultsRecommendationInput,
  type ResultsView,
} from "@/lib/copy/audit-results";

function Logo({ token }: { token: string }) {
  return (
    <Link className="audit-results-logo" href={`/audit/results/${token}`}>
      <span className="audit-results-logo-mark">
        <img src="/audit/logo-mark.svg" alt="" width={51} height={51} />
      </span>
      <span className="audit-results-wordmark">
        <img src="/audit/wordmark.svg" alt={BRAND_NAME} width={94} height={51} />
      </span>
    </Link>
  );
}

function GradeLetter({
  letter,
  color,
  className,
}: {
  letter: string | null;
  color: string | null;
  className: string;
}) {
  if (!letter) return null;
  return (
    <p
      className={className}
      data-letter={letter}
      data-grade-color={color ?? undefined}
      data-testid="pillar-grade"
    >
      {letter}
    </p>
  );
}

function CheckRowPass({
  check,
}: {
  check: ResultsPillarView["checks"][number];
}) {
  return (
    <div
      className="audit-results-check"
      data-check={check.key}
      data-outcome={check.outcome}
    >
      <span className="audit-results-check-icon" aria-hidden="true">
        <img src="/audit/check-circle.svg" alt="" width={28} height={28} />
      </span>
      <p className="audit-results-check-text">{check.passCopy}</p>
    </div>
  );
}

/**
 * Placeholder row for any non-pass outcome (fail, partial, needs_review,
 * not_assessed). Catalog display name + a plain dash only — no invented
 * copy, icon, or color. Replace when design lands.
 */
function CheckRowProvisional({
  check,
}: {
  check: ResultsPillarView["checks"][number];
}) {
  return (
    <div
      className="audit-results-check audit-results-check-provisional"
      data-check={check.key}
      data-outcome={check.outcome}
    >
      <span className="audit-results-check-marker" aria-hidden="true">
        –
      </span>
      <p className="audit-results-check-text">{check.name}</p>
    </div>
  );
}

function CheckRows({ pillar }: { pillar: ResultsPillarView }) {
  return (
    <div className="audit-results-section" data-testid="how-earned">
      <h2 className="audit-results-section-heading">{HOW_YOU_EARNED_HEADING}</h2>
      {pillar.checks.map((check) =>
        check.outcome === "pass" && check.passCopy ? (
          <CheckRowPass key={check.key} check={check} />
        ) : (
          <CheckRowProvisional key={check.key} check={check} />
        ),
      )}
      <p className="audit-results-passed">{pillar.passedSummary}</p>
    </div>
  );
}

function Recommendations({
  heading,
  items,
  emptyCopy,
}: {
  heading?: string;
  items: ResultsRecommendationInput[];
  emptyCopy: string;
}) {
  return (
    <div
      className="audit-results-section"
      data-testid="recommendations"
      data-rec-state={items.length === 0 ? "empty" : "findings"}
    >
      <h2 className="audit-results-section-heading">
        {heading ?? RECOMMENDED_IMPROVEMENTS_HEADING}
      </h2>
      {items.length === 0 ? (
        <p className="audit-results-rec-body">{emptyCopy}</p>
      ) : (
        items.map((item) => (
          <p
            className="audit-results-rec-body"
            key={`${item.priority}:${item.sortOrder}:${item.title}`}
            data-rec-priority={item.priority}
          >
            <strong>{item.title}</strong>
            {item.description ? ` — ${item.description}` : null}
          </p>
        ))
      )}
    </div>
  );
}

function VideoThumb() {
  return (
    <div className="audit-results-video">
      <img
        src="/audit/results-video.png"
        alt="Your website is working. Strong across all 3 pillars."
        width={1264}
        height={705}
      />
    </div>
  );
}

function HubHero({ view }: { view: ResultsView }) {
  return (
    <header className="audit-results-hero">
      <p className="audit-results-url">{view.websiteHost}</p>
      <h1 className="audit-results-headline">{view.headline}</h1>
    </header>
  );
}

function HubCards({
  token,
  pillars,
}: {
  token: string;
  pillars: ResultsPillarView[];
}) {
  return (
    <div className="audit-results-cards" data-testid="results-hub-cards">
      {pillars.map((pillar) => (
        <Link
          className="audit-results-card"
          href={`/audit/results/${token}/${pillar.slug}`}
          key={pillar.key}
          data-pillar={pillar.key}
        >
          <GradeLetter
            letter={pillar.letter}
            color={pillar.color}
            className="audit-results-card-grade"
          />
          <div className="audit-results-card-body">
            <h2 className="audit-results-card-title">{pillar.name}</h2>
            <p className="audit-results-card-desc">{pillar.summary}</p>
          </div>
          <span className="audit-results-chevron" aria-hidden="true">
            <img src="/audit/chevron-forward.svg" alt="" width={40} height={40} />
          </span>
        </Link>
      ))}
    </div>
  );
}

function DesktopColumn({ pillar }: { pillar: ResultsPillarView }) {
  return (
    <div className="audit-results-column" data-pillar={pillar.key}>
      <div className="audit-results-desktop-card">
        <div className="audit-results-desktop-card-body">
          <GradeLetter
            letter={pillar.letter}
            color={pillar.color}
            className="audit-results-card-grade"
          />
          <h2 className="audit-results-card-title">{pillar.name}</h2>
          <p className="audit-results-card-desc audit-results-desktop-card-desc">
            {pillar.summary}
          </p>
        </div>
      </div>
      <CheckRows pillar={pillar} />
    </div>
  );
}

export function ResultsScreen({
  token,
  mode,
  pillarKey,
  view,
  cta,
}: {
  token: string;
  mode: "hub" | "detail";
  pillarKey?: string;
  view: ResultsView;
  cta?: ReactNode;
}) {
  const detail = pillarKey
    ? view.pillars.find((pillar) => pillar.key === pillarKey)
    : undefined;

  return (
    <main className="audit-results" data-mode={mode}>
      <nav className="audit-results-nav" aria-label="Primary">
        <Logo token={token} />
        {mode === "detail" ? (
          <Link
            className="audit-results-nav-btn audit-results-go-back"
            href={`/audit/results/${token}`}
          >
            Go Back
          </Link>
        ) : null}
        <Link className="audit-results-nav-btn audit-results-cancel" href="/">
          Cancel
        </Link>
      </nav>

      {mode === "hub" ? (
        <div
          className="audit-results-content audit-results-hub"
          data-layout="hub"
          data-testid="results-hub"
        >
          <HubHero view={view} />
          <HubCards token={token} pillars={view.pillars} />
          <VideoThumb />
        </div>
      ) : null}

      {mode === "detail" && detail ? (
        <div
          className="audit-results-content audit-results-detail"
          data-layout="detail"
          data-testid="results-detail"
          data-pillar={detail.key}
        >
          <div className="audit-results-detail-hero">
            <GradeLetter
              letter={detail.letter}
              color={detail.color}
              className="audit-results-detail-grade"
            />
            <div className="audit-results-detail-copy">
              <h1 className="audit-results-detail-title">{detail.name}</h1>
              <p className="audit-results-detail-summary">{detail.summary}</p>
            </div>
          </div>
          <CheckRows pillar={detail} />
          <Recommendations
            items={detail.recommendations}
            emptyCopy={detail.noIssuesCopy}
          />
        </div>
      ) : null}

      <div
        className="audit-results-content audit-results-desktop"
        data-layout="desktop"
        data-testid="results-desktop"
      >
        <HubHero view={view} />
        <div className="audit-results-columns">
          {view.pillars.map((pillar) => (
            <DesktopColumn pillar={pillar} key={pillar.key} />
          ))}
        </div>
        <VideoThumb />
        <Recommendations
          items={view.overallRecommendations}
          emptyCopy={view.overallNoIssuesCopy}
        />
      </div>

      {mode === "hub" && cta ? (
        <div className="audit-results-sheet" data-testid="results-sheet">
          <p className="audit-results-sheet-label">{SCHEDULE_CONSULTATION_LABEL}</p>
          <div className="audit-results-sheet-cta">{cta}</div>
        </div>
      ) : null}
    </main>
  );
}
