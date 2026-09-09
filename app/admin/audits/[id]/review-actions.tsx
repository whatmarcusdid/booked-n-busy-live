"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  isReasonAcceptable,
  OVERRIDE_REASON_REQUIRED_ERROR,
  requiresReason,
  REVIEW_DECISION_BY_ACTION,
  type ReviewAction,
} from "@/lib/admin/review-history";

interface Props {
  auditId: string;
  /** Sent as `expectedRevisionNumber` so a stale tab cannot act on old data. */
  revisionNumber: number | null;
  publicationStatus: string | null;
}

type Outcome = { kind: "ok" | "error"; message: string } | null;

export function ReviewActions({
  auditId,
  revisionNumber,
  publicationStatus,
}: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<ReviewAction | "revoke" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const overrideBlocked = !isReasonAcceptable(reason);

  async function post(path: string, body?: unknown) {
    const response = await fetch(`/api/v1/admin/audits/${auditId}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(
        detail?.error ?? `Request failed with ${response.status}`,
      );
    }
    return response.json().catch(() => ({}));
  }

  async function act(action: ReviewAction) {
    // A courtesy check only. The reviews endpoint enforces the same rule with
    // the same predicate, so bypassing the UI does not bypass the guarantee.
    if (requiresReason(action) && !isReasonAcceptable(reason)) {
      setOutcome({ kind: "error", message: OVERRIDE_REASON_REQUIRED_ERROR });
      return;
    }

    setBusy(action);
    setOutcome(null);
    try {
      // The decision is recorded first, so a publish that fails still leaves
      // the human action on the record rather than losing it.
      await post("/reviews", {
        decision: REVIEW_DECISION_BY_ACTION[action],
        note: reason.trim() === "" ? undefined : reason.trim(),
        ...(revisionNumber != null
          ? { expectedRevisionNumber: revisionNumber }
          : {}),
      });

      if (action === "publish") {
        await post("/publish", {
          ...(revisionNumber != null
            ? { expectedRevisionNumber: revisionNumber }
            : {}),
        });
      }

      setReason("");
      setOutcome({
        kind: "ok",
        message:
          action === "publish"
            ? "Approved and published. The report is now reachable by the customer."
            : action === "hold"
              ? "Held. Recorded as needing changes; nothing was published."
              : "Override recorded alongside the automated result. Nothing was published.",
      });
      router.refresh();
    } catch (error) {
      setOutcome({
        kind: "error",
        message: error instanceof Error ? error.message : "Action failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy("revoke");
    setOutcome(null);
    try {
      await post("/revoke", {
        ...(revisionNumber != null
          ? { expectedRevisionNumber: revisionNumber }
          : {}),
      });
      setOutcome({
        kind: "ok",
        message: "Revoked. The public link no longer resolves.",
      });
      router.refresh();
    } catch (error) {
      setOutcome({
        kind: "error",
        message: error instanceof Error ? error.message : "Revoke failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-section" aria-label="Review decision">
      <h2>Decision</h2>
      <p>
        A report reaches the customer only through Publish here. Hold and
        Override are recorded as new rows beside the automated result, which is
        never rewritten.
      </p>

      <div className="admin-field">
        <label htmlFor="review-reason">
          Reason {overrideBlocked ? "(required to override)" : ""}
        </label>
        <textarea
          id="review-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why the automated result is wrong, or why this is being held."
        />
      </div>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          onClick={() => act("publish")}
          disabled={busy !== null}
        >
          {busy === "publish" ? "Publishing…" : "Publish"}
        </button>
        <button
          type="button"
          className="admin-button admin-button-secondary"
          onClick={() => act("hold")}
          disabled={busy !== null}
        >
          {busy === "hold" ? "Holding…" : "Hold"}
        </button>
        <button
          type="button"
          className="admin-button admin-button-danger"
          onClick={() => act("override")}
          disabled={busy !== null || overrideBlocked}
          aria-describedby="override-help"
        >
          {busy === "override" ? "Recording…" : "Override"}
        </button>
        {publicationStatus === "published" ? (
          <button
            type="button"
            className="admin-button admin-button-danger"
            onClick={revoke}
            disabled={busy !== null}
          >
            {busy === "revoke" ? "Revoking…" : "Revoke"}
          </button>
        ) : null}
      </div>

      <p id="override-help" className="admin-stat-note">
        Override is disabled until a reason is written, and the API rejects a
        reasonless override regardless. It records a <code>reject</code>{" "}
        decision with the reason attached, since the review API allows only
        approve, needs_changes, and reject.
      </p>

      {outcome ? (
        <p
          className={`admin-note ${
            outcome.kind === "ok" ? "admin-note-ok" : "admin-note-error"
          }`}
          role="status"
        >
          {outcome.message}
        </p>
      ) : null}
    </section>
  );
}
