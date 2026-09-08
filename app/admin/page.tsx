import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin/auth";
import { createSupabaseAdminStore } from "@/lib/admin/service";
import { AdminSignIn } from "./admin-sign-in";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const session = readAdminSession(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return (
      <main>
        <section className="card">
          {/* TODO(figma): admin queue chrome — not in customer Figma */}
          <h1>Admin</h1>
          {params.error === "invalid_or_expired" ? (
            <p>
              This sign-in link is invalid or expired. Request a new one.
            </p>
          ) : null}
          <AdminSignIn />
        </section>
      </main>
    );
  }

  const queue = await createSupabaseAdminStore().listAudits({
    limit: 20,
    offset: 0,
  });

  return (
    <main>
      <section className="card">
        {/* TODO(figma): admin queue chrome — not in customer Figma */}
        <h1>Admin</h1>
        <p>Signed in as {session.email}</p>
        <form action="/api/v1/admin/auth/signout" method="POST">
          <button type="submit">Sign out</button>
        </form>
        <p>{queue.total} audit{queue.total === 1 ? "" : "s"}</p>
        {queue.items.length === 0 ? (
          <p>No audits yet.</p>
        ) : (
          <ul>
            {queue.items.map((item) => (
              <li key={item.id}>
                {item.businessName} — {item.currentState}
                {item.publicationStatus ? ` (${item.publicationStatus})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
