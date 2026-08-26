import { requireSession } from "@/lib/auth/guard";
import { sumUnreadCount } from "@/data/conversations";
import { NavRail } from "./_components/nav-rail";

// Shell for every /dashboard/* route (inbox + admin alike): the left icon
// rail (context.md's own `(dashboard)/layout.tsx` already covers the
// session redirect — this one adds the persistent chrome the WhatsApp-Web
// reference has). The inbox's own conversation-list sidebar is a nested
// layout (see `(inbox)/layout.tsx`) so admin pages get the rail without
// also carrying a conversation list next to settings forms.
export default async function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const unreadTotal = await sumUnreadCount(session.organizationId);

  return (
    <div style={{ height: "100vh", display: "flex", background: "var(--bg)" }}>
      <NavRail isAdmin={session.role === "ADMIN"} unreadTotal={unreadTotal} />
      <div style={{ flex: 1, minWidth: 0, display: "flex" }}>{children}</div>
    </div>
  );
}
