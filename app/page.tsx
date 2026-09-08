import { IntakeForm } from "./intake-form";
import { getSupabaseStatus } from "@/lib/supabase/status";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const status = await getSupabaseStatus();

  return (
    <main>
      <section className="card">
        {/* TODO(figma): landing hero, trust strip, and intake visual system */}
        <p className="eyebrow">Booked N Busy</p>
        <h1>Free website diagnostic</h1>
        <p>
          Enter your site. We scan the homepage and return a short report you
          can review before anything is published.
        </p>
        <IntakeForm />
        <p
          className={`status ${
            status.configured && status.reachable ? "status-ok" : "status-wait"
          }`}
        >
          {status.configured
            ? status.reachable
              ? `Supabase connected (${status.projectHost})`
              : `Supabase keys are set, but ${status.projectHost} did not respond`
            : "Supabase is not connected yet. Add project URL and anon key."}
        </p>
      </section>
    </main>
  );
}
