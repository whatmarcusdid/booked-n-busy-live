import { AdminSignIn } from "./admin-sign-in";

export default function AdminPage() {
  return (
    <main>
      <section className="card">
        {/* TODO(figma): admin queue chrome — not in customer Figma */}
        <h1>Admin</h1>
        <AdminSignIn />
      </section>
    </main>
  );
}
