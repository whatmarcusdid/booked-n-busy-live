"use client";

import { useState } from "react";
import {
  MANUAL_REVIEW_SENT_COPY,
  SEND_REQUEST_LABEL,
} from "@/lib/copy/audit-results";
import { MdFilledButton } from "@/lib/material/md-filled-button";

export function RequestManualReview({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(
        `/api/v1/audits/${encodeURIComponent(token)}/request-manual-review`,
        { method: "POST" },
      );
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setError(json.error ?? "Could not send request.");
        return;
      }
      setSent(true);
    } catch {
      setError("Could not send request.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <p className="audit-results-sent" data-testid="manual-review-sent">
        {MANUAL_REVIEW_SENT_COPY}
      </p>
    );
  }

  return (
    <div>
      <MdFilledButton disabled={pending} onClick={onClick} type="button">
        {pending ? "Sending…" : SEND_REQUEST_LABEL}
      </MdFilledButton>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
