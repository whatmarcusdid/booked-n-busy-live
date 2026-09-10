"use client";

import { useState, type FormEvent } from "react";

export function AdminSignIn() {
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const response = await fetch("/api/v1/admin/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await response.json()) as { message?: string };
    setMessage(data.message ?? "Check your inbox if that email is allowed.");
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Admin email
        <input name="email" required type="email" />
      </label>
      <button type="submit">Email a sign-in link</button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}
