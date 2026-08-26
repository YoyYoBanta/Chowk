"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ChannelDTO {
  id: string;
  displayName: string;
  phoneNumber: string;
  provider: string;
  status: string;
  qualityRating: string | null;
  messagingTier: string | null;
}

export default function AdminChannelsPage() {
  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/channels")
      .then(res => res.json())
      .then(data => {
        if (data.channels) setChannels(data.channels);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: "var(--space-6)", background: "var(--bg)", minHeight: "100vh", color: "var(--text-primary)" }}>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <Link href="/dashboard/admin" style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.85rem" }}>
          ← Back to Admin Settings
        </Link>
      </div>

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "var(--space-5)", color: "var(--text-primary)" }}>
        Channels
      </h1>

      <div style={{ background: "var(--surface)", padding: "var(--space-5)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-panel)" }}>
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading channels…</p>
        ) : channels.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No channels connected.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-strong)" }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Phone Number</th>
                  <th style={thStyle}>Provider</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Quality Rating</th>
                  <th style={thStyle}>Messaging Tier</th>
                </tr>
              </thead>
              <tbody>
                {channels.map(channel => (
                  <tr key={channel.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "var(--space-3) var(--space-3)", color: "var(--text-primary)", fontWeight: 600 }}>{channel.displayName}</td>
                    <td style={{ padding: "var(--space-3)", color: "var(--text-secondary)" }}>{channel.phoneNumber}</td>
                    <td style={{ padding: "var(--space-3)" }}>
                      <span style={{ padding: "3px 9px", background: "var(--surface-raised)", color: "var(--text-secondary)", borderRadius: "var(--radius-sm)", fontSize: "0.78rem" }}>
                        {channel.provider}
                      </span>
                    </td>
                    <td style={{ padding: "var(--space-3)" }}>
                      <span style={{
                        padding: "3px 9px",
                        background: channel.status === "ACTIVE" ? "var(--accent-soft)" : "var(--danger-soft)",
                        color: channel.status === "ACTIVE" ? "var(--accent)" : "var(--danger)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                      }}>
                        {channel.status}
                      </span>
                    </td>
                    <td style={{ padding: "var(--space-3)", color: channel.qualityRating ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {channel.qualityRating || "N/A"}
                    </td>
                    <td style={{ padding: "var(--space-3)", color: channel.messagingTier ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {channel.messagingTier || "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle = {
  padding: "var(--space-3)",
  fontWeight: 700,
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
} as const;
