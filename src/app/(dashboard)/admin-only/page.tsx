import { requireRole } from "@/lib/auth/guard";

// Placeholder route existing purely to exercise the role gate end-to-end:
// there is no admin-only feature yet, but M1's "done when" bar requires
// the mechanism to distinguish ADMIN vs AGENT to be provable, not just
// theoretical. Real admin-only routes arrive in later milestones.
export default async function AdminOnlyPage() {
  const session = await requireRole("ADMIN");

  return (
    <main>
      <h1>Admin only</h1>
      <p>
        Signed in as user {session.userId} (role: {session.role}). If you can
        see this, the role gate let an ADMIN through — see
        src/lib/auth/guard.ts.
      </p>
    </main>
  );
}
