"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TIMING_PROMISE } from "@/lib/copy/timing";
import { MdFilledButton } from "@/lib/material/md-filled-button";
import { MdOutlinedTextField } from "@/lib/material/md-outlined-text-field";

export function IntakeForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const named = (name: string) => {
      const fromData = String(data.get(name) ?? "").trim();
      if (fromData) return fromData;
      const el = form.querySelector(`[name="${name}"]`) as
        | { value?: string }
        | null;
      return String(el?.value ?? "").trim();
    };
    const payload = {
      websiteUrl: named("websiteUrl"),
      businessName: named("businessName"),
      firstName: named("firstName"),
      email: named("email"),
      consent: {
        reportDelivery: true,
        followUp: false,
      },
    };

    try {
      const response = await fetch("/api/v1/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        statusUrl?: string;
        error?: string;
        fields?: Array<{ field: string; message: string }>;
      };
      if (!response.ok || !data.statusUrl) {
        setError(
          data.fields?.map((field) => field.message).join(" ") ||
            data.error ||
            "Could not start the audit.",
        );
        return;
      }
      router.push(data.statusUrl);
    } catch {
      setError("Could not start the audit.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="landing-form" onSubmit={onSubmit}>
      <MdOutlinedTextField
        name="firstName"
        label="First name"
        required
        autocomplete="given-name"
      />
      <MdOutlinedTextField
        name="businessName"
        label="Business name"
        required
        autocomplete="organization"
      />
      <MdOutlinedTextField
        name="email"
        label="Email address"
        type="email"
        required
        autocomplete="email"
      />
      <MdOutlinedTextField
        name="websiteUrl"
        label="Website URL"
        required
        autocomplete="url"
      />
      <MdFilledButton disabled={pending} type="submit">
        {pending ? "Starting…" : "Run My Free Audit"}
      </MdFilledButton>
      <p className="landing-disclaimer">
        No login required. {TIMING_PROMISE} Your PDF report will be emailed to
        you automatically.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
