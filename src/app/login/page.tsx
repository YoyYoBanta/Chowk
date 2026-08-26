import type { CSSProperties } from "react";
import { PRODUCT_NAME } from "@/config/branding";
import { loginAction } from "./actions";

// Plain object type rather than Next's generated PageProps — see
// src/app/layout.tsx for why (no prior `.next/types` build to generate
// against). searchParams is a Promise per the App Router's async dynamic
// APIs (Next 15+).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background:
          "radial-gradient(60rem 40rem at 15% -10%, rgba(34,181,122,0.08), transparent), var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "23rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div
            aria-hidden
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "var(--radius-md)",
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-soft-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.4rem",
              margin: "0 auto var(--space-4)",
            }}
          >
            💬
          </div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Log in to {PRODUCT_NAME}
          </h1>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Your team&apos;s WhatsApp inbox
          </p>
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-5)",
            boxShadow: "var(--shadow-panel)",
          }}
        >
          {error && (
            <p
              role="alert"
              style={{
                margin: "0 0 var(--space-4)",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-sm)",
                background: "var(--danger-soft)",
                color: "var(--danger)",
                fontSize: "0.85rem",
              }}
            >
              {error}
            </p>
          )}

          <form action={loginAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Password</span>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                style={inputStyle}
              />
            </label>
            <button
              type="submit"
              style={{
                marginTop: "var(--space-2)",
                padding: "0.7rem",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background: "var(--accent)",
                color: "var(--text-on-accent)",
                fontWeight: 700,
                fontSize: "0.95rem",
                cursor: "pointer",
              }}
            >
              Log in
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

const inputStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg)",
  color: "var(--text-primary)",
  fontSize: "0.95rem",
  outline: "none",
};
