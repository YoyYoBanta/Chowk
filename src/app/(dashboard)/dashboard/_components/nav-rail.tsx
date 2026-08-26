"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../logout-action";

/**
 * Left icon rail, styled after WhatsApp Business Web's own nav rail (the
 * maintainer's explicit visual reference). Deliberately lists only
 * destinations Chowk actually has — Inbox and, for admins, Admin/Settings —
 * not the reference's Calls/Status/Communities/Store/Broadcast icons, which
 * don't correspond to anything this product has built.
 */
export function NavRail({
  isAdmin,
  unreadTotal,
}: {
  isAdmin: boolean;
  unreadTotal: number;
}) {
  const pathname = usePathname();
  const inboxActive = pathname === "/dashboard" || pathname.startsWith("/dashboard/conversations");
  const adminActive = pathname.startsWith("/dashboard/admin");

  return (
    <nav
      style={{
        width: "72px",
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-4) 0",
        background: "var(--surface-raised)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
        <RailIcon href="/dashboard" label="Inbox" active={inboxActive} badge={unreadTotal > 0 ? unreadTotal : null}>
          <InboxIcon />
        </RailIcon>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
        {isAdmin && (
          <RailIcon href="/dashboard/admin" label="Admin settings" active={adminActive}>
            <SettingsIcon />
          </RailIcon>
        )}
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="Log out"
            title="Log out"
            style={{ ...railButtonStyle, color: "var(--text-muted)" }}
          >
            <LogoutIcon />
          </button>
        </form>
      </div>
    </nav>
  );
}

function RailIcon({
  href,
  label,
  active,
  badge,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number | null;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      style={{
        ...railButtonStyle,
        position: "relative",
        color: active ? "var(--accent)" : "var(--text-muted)",
        background: active ? "var(--accent-soft)" : "transparent",
      }}
    >
      {children}
      {badge != null && (
        <span
          style={{
            position: "absolute",
            top: "2px",
            right: "2px",
            minWidth: "16px",
            height: "16px",
            padding: "0 4px",
            borderRadius: "var(--radius-full)",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            fontSize: "0.62rem",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

const railButtonStyle: React.CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "var(--radius-md)",
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  textDecoration: "none",
  background: "transparent",
};

function InboxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v6h-6" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
