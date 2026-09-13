"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TIMING_PROMISE } from "@/lib/copy/timing";
import { MdFilledButton } from "@/lib/material/md-filled-button";
import { MdOutlinedTextField } from "@/lib/material/md-outlined-text-field";

const INTAKE_FIELD_NAMES = [
  "firstName",
  "businessName",
  "email",
  "websiteUrl",
] as const;

type IntakeFieldName = (typeof INTAKE_FIELD_NAMES)[number];

function isIntakeFieldName(value: string): value is IntakeFieldName {
  return (INTAKE_FIELD_NAMES as readonly string[]).includes(value);
}

export function IntakeForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<IntakeFieldName, string>>
  >({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
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
        const nextFieldErrors: Partial<Record<IntakeFieldName, string>> = {};
        const unmatched: string[] = [];
        for (const item of data.fields ?? []) {
          if (isIntakeFieldName(item.field)) {
            nextFieldErrors[item.field] = item.message;
          } else {
            unmatched.push(item.message);
          }
        }
        setFieldErrors(nextFieldErrors);
        const matchedCount = Object.keys(nextFieldErrors).length;
        const summary =
          unmatched.join(" ") ||
          (matchedCount !== 1
            ? data.fields?.map((field) => field.message).join(" ") ||
              data.error ||
              "Could not start the audit."
            : null);
        setError(summary);
        return;
      }
      router.push(data.statusUrl);
    } catch {
      setFieldErrors({});
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
        className={fieldErrors.firstName ? "is-invalid" : undefined}
        error={fieldErrors.firstName ? true : undefined}
        errorText={fieldErrors.firstName}
        aria-invalid={fieldErrors.firstName ? true : undefined}
      />
      <MdOutlinedTextField
        name="businessName"
        label="Business name"
        required
        autocomplete="organization"
        className={fieldErrors.businessName ? "is-invalid" : undefined}
        error={fieldErrors.businessName ? true : undefined}
        errorText={fieldErrors.businessName}
        aria-invalid={fieldErrors.businessName ? true : undefined}
      />
      <MdOutlinedTextField
        name="email"
        label="Email address"
        type="email"
        required
        autocomplete="email"
        className={fieldErrors.email ? "is-invalid" : undefined}
        error={fieldErrors.email ? true : undefined}
        errorText={fieldErrors.email}
        aria-invalid={fieldErrors.email ? true : undefined}
      />
      <MdOutlinedTextField
        name="websiteUrl"
        label="Website URL"
        required
        autocomplete="url"
        className={fieldErrors.websiteUrl ? "is-invalid" : undefined}
        error={fieldErrors.websiteUrl ? true : undefined}
        errorText={fieldErrors.websiteUrl}
        aria-invalid={fieldErrors.websiteUrl ? true : undefined}
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
