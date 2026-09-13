"use client";

import type { LoadingView, ProgressStageView } from "@/lib/copy/audit-progress";
import type { AuditStatusResponse } from "@/lib/schemas/audit-status";
import { TradeChips } from "./trade-chips";

const HOURGLASS: Record<string, string> = {
  normal: "/audit/hourglass-normal.svg",
  slow: "/audit/hourglass-slow.svg",
  review: "/audit/hourglass-review.svg",
};

function StageRow({ stage }: { stage: ProgressStageView }) {
  return (
    <li
      className="audit-loading-row audit-loading-stage"
      data-progress={stage.progress}
      data-stage={stage.key}
    >
      <span className="audit-loading-row-icon is-mark" aria-hidden="true">
        {/* Only the running stage is marked, so the animation never implies
            work on a stage that has not started or is waiting for review. */}
        {stage.progress === "active" ? (
          <img src="/audit/stage-mark.svg" alt="" width={30} height={30} />
        ) : null}
      </span>
      <p className="audit-loading-row-text">{stage.label}</p>
    </li>
  );
}

export function LoadingScreen({
  view,
  data,
  token,
}: {
  view: LoadingView;
  data: AuditStatusResponse;
  token: string;
}) {
  const target = data.businessName || data.websiteUrl;

  return (
    <div className="audit-loading-content" data-state={view.state}>
      <section className="audit-loading-hero">
        <h1 className="audit-loading-headline">{view.headline}</h1>
        <p className="audit-loading-target">
          <strong>{target}</strong>
          {data.businessName && data.websiteUrl ? ` · ${data.websiteUrl}` : null}
        </p>
        <div
          className={`audit-loading-row audit-loading-status is-${view.statusLine.tone}`}
          data-testid="timing-copy"
        >
          <span className="audit-loading-row-icon" aria-hidden="true">
            <img
              src={HOURGLASS[view.statusLine.tone]}
              alt=""
              width={24}
              height={24}
            />
          </span>
          <p className="audit-loading-row-text">
            {view.statusLine.lead}
            {view.statusLine.emphasis ? (
              <strong>{view.statusLine.emphasis}</strong>
            ) : null}
          </p>
        </div>
        <ol className="audit-loading-stages" aria-label="Audit progress">
          {view.stages.map((stage) => (
            <StageRow key={stage.key} stage={stage} />
          ))}
        </ol>
      </section>

      {view.waitCard ? (
        <section className="audit-loading-section audit-loading-wait">
          <h2 className="audit-loading-section-heading">
            {view.waitCard.heading}
          </h2>
          <div className="audit-loading-card">
            <div className="audit-loading-card-body">
              <span className="audit-loading-card-icon" aria-hidden="true">
                <img src="/audit/email-icon.png" alt="" width={40} height={40} />
              </span>
              <p className="audit-loading-card-text">{view.waitCard.body}</p>
            </div>
          </div>
        </section>
      ) : null}

      <TradeChips token={token} />
    </div>
  );
}

