// The right-pane empty state shown when no conversation is open — the
// WhatsApp-Web reference's own equivalent screen when the app first loads.
// No conversation-fetching happens here anymore; the list itself now lives
// in `(inbox)/layout.tsx` as the always-visible sidebar next to this.
export default function InboxEmptyState() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-5)",
        padding: "var(--space-6)",
        background: "var(--surface-raised)",
        textAlign: "center",
      }}
    >
      <EmptyStateIllustration />
      <div style={{ maxWidth: "26rem", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 300, color: "var(--text-primary)" }}>Chowk</h1>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.95rem" }}>
          Select a conversation from the list to view its messages, or wait for a new one to come in.
        </p>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          color: "var(--text-muted)",
          fontSize: "0.8rem",
          marginTop: "var(--space-4)",
        }}
      >
        <LockIcon />
        Messages are sent and received over your organization&apos;s connected WhatsApp channel.
      </div>
    </div>
  );
}

function EmptyStateIllustration() {
  return (
    <svg width="180" height="180" viewBox="0 0 200 200" fill="none" aria-hidden>
      <circle cx="100" cy="100" r="96" fill="var(--accent-soft)" />
      <rect x="62" y="46" width="76" height="120" rx="14" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <rect x="72" y="62" width="56" height="76" rx="4" fill="var(--accent-soft)" />
      <circle cx="100" cy="150" r="5" fill="var(--border-strong)" />
      <path
        d="M96 90h34a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-14l-8 8v-8h-12a6 6 0 0 1-6-6V96a6 6 0 0 1 6-6z"
        fill="var(--accent)"
      />
      <circle cx="102" cy="104" r="2.4" fill="var(--surface)" />
      <circle cx="112" cy="104" r="2.4" fill="var(--surface)" />
      <circle cx="122" cy="104" r="2.4" fill="var(--surface)" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
