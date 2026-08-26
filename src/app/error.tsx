"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary — the same purpose as `(dashboard)/error.tsx`
 * but for anything outside that route group (currently just `/login`).
 * Next.js only falls back to this when no more specific `error.tsx`
 * further down the tree caught the error first.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled render error:", error);
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
        An unexpected error occurred loading this page.
      </p>
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
    </div>
  );
}
