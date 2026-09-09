"use client";

import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics/events";
import { resolveLoadingView } from "@/lib/copy/audit-progress";
import { resolveTimingView } from "@/lib/copy/timing";
import type { AuditStatusResponse } from "@/lib/schemas/audit-status";
import { LoadingScreen } from "./loading-screen";

const POLL_INTERVAL_MS = 3000;

/** Terminal states that produced a report the customer can be shown. */
const REPORTING_STATES = new Set(["complete", "partial"]);

export function StatusPoller({
  token,
  initial = null,
}: {
  token: string;
  initial?: AuditStatusResponse | null;
}) {
  const [data, setData] = useState<AuditStatusResponse | null>(initial);
  const [error, setError] = useState<string | null>(null);

  const fallbackShown = useRef(false);
  const completionReported = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const response = await fetch(`/api/v1/audit-status/${token}`);
        const json = (await response.json()) as AuditStatusResponse & {
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setError(json.error ?? "Status is not available.");
          return;
        }
        setData(json);
        setError(null);

        const timing = resolveTimingView({
          status: json.status,
          elapsedMs: json.elapsedMs ?? 0,
          fallbackAlreadyShown: fallbackShown.current,
          completionAlreadyReported: completionReported.current,
        });
        if (timing.event) {
          trackEvent(timing.event, { elapsed_ms: json.elapsedMs ?? 0 });
        }
        if (timing.showFallback) fallbackShown.current = true;
        if (!timing.keepPolling) completionReported.current = true;

        // Elapsed time comes from the server, so the decision to keep polling
        // is the same one a fresh page load would make.
        const view = resolveLoadingView({
          status: json.status,
          elapsedMs: json.elapsedMs ?? 0,
        });
        if (view?.keepPolling ?? false) {
          timer = setTimeout(load, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setError("Status is not available.");
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  if (error) {
    return (
      <div className="audit-loading-content">
        <p role="alert">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="audit-loading-content">
        <p className="audit-loading-target">Checking your audit…</p>
      </div>
    );
  }

  const view = resolveLoadingView({
    status: data.status,
    elapsedMs: data.elapsedMs ?? 0,
  });

  if (view) return <LoadingScreen view={view} data={data} />;

  /*
   * States this screen does not own. A finished audit routes straight to
   * results, which is what makes the slow state safe to show indefinitely:
   * an audit that completes at three minutes still lands the live session on
   * its report rather than pushing it to email.
   */
  return (
    <div className="audit-loading-content">
      <section className="audit-loading-hero">
        <h1 className="audit-loading-headline">{data.progress.currentStep}</h1>
        {REPORTING_STATES.has(data.status) ? (
          <p className="audit-loading-target">
            <a
              className="audit-loading-cancel"
              href={`/audit/results/${token}`}
            >
              View your results
            </a>
          </p>
        ) : null}
      </section>
    </div>
  );
}
