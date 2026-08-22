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
    <div style={{ padding: "3rem", background: "#0a0a0b", minHeight: "100vh", color: "#e2e2e2", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ marginBottom: "2rem" }}>
        <Link href="/dashboard/admin" style={{ color: "#818cf8", textDecoration: "none", fontSize: "0.9em" }}>
          ← Back to Admin Settings
        </Link>
      </div>

      <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "2rem", background: "linear-gradient(135deg, #6366f1, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        Channels
      </h1>

      <div style={{ background: "#111113", padding: "2rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        {loading ? (
          <p style={{ opacity: 0.5 }}>Loading channels...</p>
        ) : channels.length === 0 ? (
          <p style={{ opacity: 0.5 }}>No channels connected.</p>
        ) : (
          <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                <th style={{ padding: "1rem", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Name</th>
                <th style={{ padding: "1rem", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Phone Number</th>
                <th style={{ padding: "1rem", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Provider</th>
                <th style={{ padding: "1rem", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Status</th>
                <th style={{ padding: "1rem", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Quality Rating</th>
                <th style={{ padding: "1rem", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Messaging Tier</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(channel => (
                <tr key={channel.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "1rem", color: "#fff", fontWeight: 500 }}>{channel.displayName}</td>
                  <td style={{ padding: "1rem", color: "rgba(255,255,255,0.8)" }}>{channel.phoneNumber}</td>
                  <td style={{ padding: "1rem" }}>
                    <span style={{ padding: "4px 8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", fontSize: "0.8em" }}>
                      {channel.provider}
                    </span>
                  </td>
                  <td style={{ padding: "1rem" }}>
                    <span style={{ 
                      padding: "4px 8px", 
                      background: channel.status === "ACTIVE" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)", 
                      color: channel.status === "ACTIVE" ? "#4ade80" : "#f87171",
                      borderRadius: "4px", 
                      fontSize: "0.8em",
                      fontWeight: 600
                    }}>
                      {channel.status}
                    </span>
                  </td>
                  <td style={{ padding: "1rem", color: channel.qualityRating ? "#fff" : "rgba(255,255,255,0.3)" }}>
                    {channel.qualityRating || "N/A"}
                  </td>
                  <td style={{ padding: "1rem", color: channel.messagingTier ? "#fff" : "rgba(255,255,255,0.3)" }}>
                    {channel.messagingTier || "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
