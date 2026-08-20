import { requireSession } from "@/lib/auth/guard";

// Authenticated shell for every route under this group. requireSession()
// redirects to /login when there is no session — every page nested here
// (including src/app/(dashboard)/admin-only/page.tsx) inherits that check
// for free, per architecture.md §12's "organizationId from session only"
// rule and context.md's M1 role-gate requirement.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <>{children}</>;
}
