"use client";

import { useState, type FormEvent } from "react";
import { MdFilledButton } from "@/lib/material/md-filled-button";
import { MdOutlinedTextField } from "@/lib/material/md-outlined-text-field";

/**
 * One-field re-request for an expired report link.
 *
 * The server decides whether this re-sends access or starts a fresh scan
 * based on whether the data is still retained — the form does not, and must
 * not, since the customer cannot know what is still on file.
 */
export function ExpiredReportRequest({
  retained,
}: {
  retained?: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/reports/re-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(data.get("email") ?? "").trim() }),
      });
      const json = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(json.error ?? "Could not process that request.");
        return;
      }
      setMessage(json.message ?? "Check your email.");
    } catch {
      setError("Could not process that request.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <MdOutlinedTextField
        name="email"
        label="Email address"
        type="email"
        required
        autocomplete="email"
      />
      <MdFilledButton disabled={pending} type="submit">
        {pending
          ? "Sending…"
          : retained === false
            ? "Run a new scan"
            : "Send me a new link"}
      </MdFilledButton>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
