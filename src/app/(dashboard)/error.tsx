"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Dashboard route-group error boundary (context.md §12 — M9's UI hardening
 * item, implementation-plan.md). Next.js App Router convention: this
 * `error.tsx` is a Client Component boundary that catches any render/effect
 * error thrown anywhere under `(dashboard)/**` and replaces just that
 * segment with this UI, rather than a blank white screen or a crashed tab.
 * `reset()` re-renders the segment; a plain link back to `/dashboard` is
 * the fallback if the error keeps recurring on retry.
 *
 * Never logs `error.message` alongside anything that could carry message
 * content (context.md §12's own rule) — a render error's message is a
 * stack-trace-adjacent string about component state, not user data, but
 * kept off any structured log line with organizationId/conversationId
 * context regardless, since this runs client-side with no session access
 * to scope such a log to in the first place.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] unhandled render error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        background: "var(--bg)",
        color: "var(--text-primary)",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
        Something went wrong
      </h1>
      <p style={{ maxWidth: "32rem", color: "var(--text-secondary)", margin: 0 }}>
        This part of the page hit an unexpected error. Your conversations and data are safe — try again, or head
        back to the inbox.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.6rem 1.5rem",
            background: "var(--accent)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-on-accent)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          style={{
            padding: "0.6rem 1.5rem",
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Back to inbox
        </Link>
      </div>
    </div>
  );
}
