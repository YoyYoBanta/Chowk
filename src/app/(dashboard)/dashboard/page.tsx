import { requireSession } from "@/lib/auth/guard";
import { logoutAction } from "./logout-action";

export default async function DashboardHome() {
  const session = await requireSession();

  return (
    <main>
      <h1>Dashboard</h1>
      <p>
        Signed in as user {session.userId} (role: {session.role}) in
        organization {session.organizationId}.
      </p>
      <p>Placeholder — no product features yet (M1 is auth + tenancy scaffolding only).</p>
      <form action={logoutAction}>
        <button type="submit">Log out</button>
      </form>
    </main>
  );
}
