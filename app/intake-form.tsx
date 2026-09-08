"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function IntakeForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      websiteUrl: String(form.get("websiteUrl") ?? ""),
      businessName: String(form.get("businessName") ?? ""),
      firstName: String(form.get("firstName") ?? ""),
      email: String(form.get("email") ?? ""),
      trade: String(form.get("trade") ?? ""),
      serviceArea: String(form.get("serviceArea") ?? ""),
      phone: String(form.get("phone") ?? "") || undefined,
      primaryConcern: String(form.get("primaryConcern") ?? "") || undefined,
      consent: {
        reportDelivery: form.get("reportDelivery") === "on",
        followUp: form.get("followUp") === "on",
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
    <form onSubmit={onSubmit}>
      {/* TODO(figma): replace this unstyled intake layout with the landing hero + form from Figma */}
      <label>
        Website URL
        <input name="websiteUrl" required type="text" />
      </label>
      <label>
        Business name
        <input name="businessName" required type="text" />
      </label>
      <label>
        First name
        <input name="firstName" required type="text" />
      </label>
      <label>
        Email
        <input name="email" required type="email" />
      </label>
      <label>
        Trade
        <input name="trade" required type="text" />
      </label>
      <label>
        Service area
        <input name="serviceArea" required type="text" />
      </label>
      <label>
        Phone
        <input name="phone" type="text" />
      </label>
      <label>
        Primary concern
        <input name="primaryConcern" type="text" />
      </label>
      <label>
        <input name="reportDelivery" type="checkbox" required />I want the
        diagnostic report emailed to me
      </label>
      <label>
        <input name="followUp" type="checkbox" />
        Follow-up is okay
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={pending} type="submit">
        {pending ? "Starting…" : "Start diagnostic"}
      </button>
    </form>
  );
}
