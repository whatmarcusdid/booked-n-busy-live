"use client";

import { useEffect, useRef, useState } from "react";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics/events";
import {
  REPORT_BOOKING_SESSIONS_PATH,
  REPORT_PREPARE_PATH,
} from "@/lib/copy/pre-call";
import { MdFilledButton } from "@/lib/material/md-filled-button";

export const BOOK_FINDINGS_CALL_LABEL = "Book your findings call";

/**
 * The only action on the results page.
 *
 * Report email delivery is automatic and does not depend on this button, so
 * there is no competing "email me the report" action to offer — that was the
 * point of collapsing to one CTA.
 */
export function BookFindingsCall({
  statusToken,
  label = BOOK_FINDINGS_CALL_LABEL,
}: {
  statusToken?: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewed = useRef(false);
  const anchor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = anchor.current;
    if (!node || viewed.current) return;

    // A view is recorded when the CTA is actually on screen, not when the
    // page mounts, so the metric means "had the chance to click".
    if (typeof IntersectionObserver === "undefined") {
      viewed.current = true;
      trackEvent(ANALYTICS_EVENTS.resultsCtaViewed);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !viewed.current) {
          viewed.current = true;
          trackEvent(ANALYTICS_EVENTS.resultsCtaViewed);
          observer.disconnect();
        }
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  async function onClick() {
    setError(null);
    setPending(true);
    trackEvent(ANALYTICS_EVENTS.resultsCtaClicked);
    try {
      const bookingUrl = statusToken
        ? "/api/v1/booking-sessions"
        : REPORT_BOOKING_SESSIONS_PATH;
      const response = await fetch(bookingUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(statusToken ? { statusToken } : {}),
      });
      const json = (await response.json()) as {
        bookingSessionId?: string;
        scheduleUrl?: string;
        error?: string;
      };
      if (!response.ok || !json.scheduleUrl) {
        setError(json.error ?? "Could not start booking.");
        return;
      }
      trackEvent(ANALYTICS_EVENTS.bookingSessionCreated, {
        booking_session_id: json.bookingSessionId ?? null,
      });
      window.location.assign(
        statusToken
          ? `/audit/prepare/${statusToken}`
          : REPORT_PREPARE_PATH,
      );
    } catch {
      setError("Could not start booking.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={anchor}>
      <MdFilledButton disabled={pending} onClick={onClick} type="button">
        {pending ? "Starting…" : label}
      </MdFilledButton>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
