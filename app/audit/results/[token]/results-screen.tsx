import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/identity";
import {
  FAILED_BODY_LEAD,
  FAILED_BODY_TAIL,
  FAILED_MANUAL_REVIEW_QUESTION,
  HOW_YOU_EARNED_HEADING,
  NOT_ASSESSED_CARD_SUBTITLE,
  NOT_ASSESSED_CARD_TITLE,
  NOT_ASSESSED_GRADE,
  RECOMMENDED_IMPROVEMENTS_HEADING,
  REQUEST_MANUAL_REVIEW_LABEL,
  RESULTS_CLOSE_LABEL,
  SCHEDULE_CONSULTATION_LABEL,
  UNSUPPORTED_BODY,
  type ResultsAuditState,
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
  unassessed = false,
}: {
  letter: string | null;
  color: string | null;
  className: string;
  unassessed?: boolean;
}) {
  if (!letter && !unassessed) return null;
  const display = letter ?? NOT_ASSESSED_GRADE;
  return (
    <p
      className={className}
      data-letter={letter ?? "unassessed"}
      data-grade-color={color ?? undefined}
      data-testid="pillar-grade"
    >
      {display}
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
  variant,
}: {
  token: string;
  pillars: ResultsPillarView[];
  variant: ResultsAuditState;
}) {
  return (
    <div className="audit-results-cards" data-testid="results-hub-cards">
      {pillars.map((pillar) => {
        const unassessed = variant === "partial" && pillar.unassessed;
        return (
          <Link
            className="audit-results-card"
            href={`/audit/results/${token}/${pillar.slug}`}
            key={pillar.key}
            data-pillar={pillar.key}
            data-unassessed={unassessed ? "true" : undefined}
          >
            <GradeLetter
              letter={pillar.letter}
              color={pillar.color}
              className="audit-results-card-grade"
              unassessed={unassessed}
            />
            <div className="audit-results-card-body">
              <h2 className="audit-results-card-title">
                {unassessed ? NOT_ASSESSED_CARD_TITLE : pillar.name}
              </h2>
              <p className="audit-results-card-desc">{pillar.summary}</p>
            </div>
            <span className="audit-results-chevron" aria-hidden="true">
              <img src="/audit/chevron-forward.svg" alt="" width={40} height={40} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function DesktopColumn({
  pillar,
  variant,
}: {
  pillar: ResultsPillarView;
  variant: ResultsAuditState;
}) {
  const unassessed = variant === "partial" && pillar.unassessed;
  return (
    <div className="audit-results-column" data-pillar={pillar.key}>
      <div className="audit-results-desktop-card">
        <div className="audit-results-desktop-card-body">
          <GradeLetter
            letter={pillar.letter}
            color={pillar.color}
            className="audit-results-card-grade"
            unassessed={unassessed}
          />
          <h2 className="audit-results-card-title">
            {unassessed ? NOT_ASSESSED_CARD_TITLE : pillar.name}
          </h2>
          <p className="audit-results-card-desc audit-results-desktop-card-desc">
            {pillar.summary}
          </p>
        </div>
      </div>
      <CheckRows pillar={pillar} />
    </div>
  );
}

function NotAssessedCard() {
  return (
    <div
      className="audit-results-card audit-results-card-static"
      data-testid="not-assessed-card"
    >
      <GradeLetter
        letter={null}
        color={null}
        className="audit-results-card-grade"
        unassessed
      />
      <div className="audit-results-card-body">
        <h2 className="audit-results-card-title">{NOT_ASSESSED_CARD_TITLE}</h2>
        <p className="audit-results-card-desc">{NOT_ASSESSED_CARD_SUBTITLE}</p>
      </div>
    </div>
  );
}

function TerminalBody({ view }: { view: ResultsView }) {
  if (view.auditState === "failed") {
    return (
      <div className="audit-results-terminal-copy" data-testid="terminal-body">
        <p>
          {FAILED_BODY_LEAD}
          <a
            className="audit-results-inline-link"
            href={`https://${view.websiteHost}`}
            rel="noreferrer"
            target="_blank"
          >
            {view.websiteHost}
          </a>
          {FAILED_BODY_TAIL}
        </p>
        <p className="audit-results-terminal-question">
          {FAILED_MANUAL_REVIEW_QUESTION}
        </p>
      </div>
    );
  }
  return (
    <div className="audit-results-terminal-copy" data-testid="terminal-body">
      <p>{UNSUPPORTED_BODY}</p>
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
  const variant = view.auditState;
  const terminal = variant === "failed" || variant === "unsupported";
  const detail = pillarKey
    ? view.pillars.find((pillar) => pillar.key === pillarKey)
    : undefined;
  const sheetLabel =
    variant === "failed"
      ? REQUEST_MANUAL_REVIEW_LABEL
      : variant === "partial"
        ? null
        : SCHEDULE_CONSULTATION_LABEL;
  const closeLabel = terminal ? RESULTS_CLOSE_LABEL : "Cancel";
  const showVideo = variant === "complete" || variant === "needs_review";

  return (
    <main
      className="audit-results"
      data-mode={mode}
      data-variant={variant}
    >
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
          {closeLabel}
        </Link>
      </nav>

      {mode === "hub" && !terminal ? (
        <div
          className="audit-results-content audit-results-hub"
          data-layout="hub"
          data-testid="results-hub"
        >
          <HubHero view={view} />
          <HubCards token={token} pillars={view.pillars} variant={variant} />
          {showVideo ? <VideoThumb /> : null}
        </div>
      ) : null}

      {mode === "hub" && terminal ? (
        <div
          className="audit-results-content audit-results-hub"
          data-layout="hub"
          data-testid="results-terminal"
        >
          <HubHero view={view} />
          <NotAssessedCard />
          <TerminalBody view={view} />
          {cta ? (
            <div
              className="audit-results-terminal-cta"
              data-testid="terminal-cta"
            >
              {variant === "failed" ? (
                <p className="audit-results-sheet-label">
                  {REQUEST_MANUAL_REVIEW_LABEL}
                </p>
              ) : null}
              <div className="audit-results-sheet-cta">{cta}</div>
            </div>
          ) : null}
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
              unassessed={variant === "partial" && detail.unassessed}
            />
            <div className="audit-results-detail-copy">
              <h1 className="audit-results-detail-title">
                {variant === "partial" && detail.unassessed
                  ? NOT_ASSESSED_CARD_TITLE
                  : detail.name}
              </h1>
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

      {!terminal ? (
        <div
          className="audit-results-content audit-results-desktop"
          data-layout="desktop"
          data-testid="results-desktop"
        >
          <HubHero view={view} />
          <div className="audit-results-columns">
            {view.pillars.map((pillar) => (
              <DesktopColumn
                pillar={pillar}
                variant={variant}
                key={pillar.key}
              />
            ))}
          </div>
          {showVideo ? <VideoThumb /> : null}
          <Recommendations
            items={view.overallRecommendations}
            emptyCopy={view.overallNoIssuesCopy}
          />
        </div>
      ) : null}

      {mode === "hub" && cta ? (
        <div className="audit-results-sheet" data-testid="results-sheet">
          {sheetLabel ? (
            <p className="audit-results-sheet-label">{sheetLabel}</p>
          ) : null}
          <div className="audit-results-sheet-cta">{cta}</div>
        </div>
      ) : null}
    </main>
  );
}
