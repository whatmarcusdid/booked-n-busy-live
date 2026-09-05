import { getSupabaseStatus } from "@/lib/supabase/status";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const status = await getSupabaseStatus();

  return (
    <main>
      <section className="card">
        <p className="eyebrow">Booked N Busy Live</p>
        <h1>Your booking site is live.</h1>
        <p>
          This Next.js app is deployed on Vercel. Next up: scheduling,
          availability, and checkout.
        </p>
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
