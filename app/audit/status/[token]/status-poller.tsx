"use client";

import { useEffect, useState } from "react";
import type { AuditStatusResponse } from "@/lib/schemas/audit-status";

const TERMINAL = new Set([
  "complete",
  "partial",
  "needs_review",
  "failed",
  "unsupported",
]);

export function StatusPoller({ token }: { token: string }) {
  const [data, setData] = useState<AuditStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (!TERMINAL.has(json.status)) {
          timer = setTimeout(load, 3000);
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

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <div>
      {/* TODO(figma): progress bar and step copy styling */}
      <p>{data.progress.currentStep}</p>
      <p>{data.progress.percentage}%</p>
      {data.progress.estimatedTimeRemaining ? (
        <p>About {data.progress.estimatedTimeRemaining} remaining</p>
      ) : null}
      {data.report ? (
        <div>
          <p>Report status: {data.report.publicationStatus}</p>
          {data.report.publicationStatus === "published" ? (
            <p>
              When you have the public report link, open{" "}
              <a href="/report">the report page</a>.
            </p>
          ) : (
            <p>The report is in review and is not public yet.</p>
          )}
        </div>
      ) : null}
      {data.status === "failed" || data.status === "unsupported" ? (
        <p>{data.progress.currentStep}</p>
      ) : null}
    </div>
  );
}
