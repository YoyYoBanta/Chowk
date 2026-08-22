"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface TagDTO {
  id: string;
  name: string;
  color: string | null;
}

interface QuickReplyDTO {
  id: string;
  shortcut: string;
  body: string;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"tags" | "fields" | "replies">("tags");

  const [tags, setTags] = useState<TagDTO[]>([]);
  const [newTag, setNewTag] = useState("");

  const [replies, setReplies] = useState<QuickReplyDTO[]>([]);
  const [newShortcut, setNewShortcut] = useState("");
  const [newBody, setNewBody] = useState("");

  useEffect(() => {
    fetch("/api/tags").then(res => res.json()).then(data => {
      if (data.tags) setTags(data.tags);
    }).catch(console.error);

    fetch("/api/quick-replies").then(res => res.json()).then(data => {
      if (data.quickReplies) setReplies(data.quickReplies);
    }).catch(console.error);
  }, []);

  const handleCreateTag = async () => {
    if (!newTag.trim()) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTag.trim() })
    });
    const data = await res.json();
    if (data.tag) {
      setTags([...tags, data.tag]);
      setNewTag("");
    }
  };

  const handleCreateReply = async () => {
    if (!newShortcut.trim() || !newBody.trim()) return;
    const res = await fetch("/api/quick-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortcut: newShortcut.trim(), body: newBody.trim() })
    });
    const data = await res.json();
    if (data.quickReply) {
      setReplies([...replies, data.quickReply]);
      setNewShortcut("");
      setNewBody("");
    }
  };

  return (
    <div style={{ padding: "3rem", background: "#0a0a0b", minHeight: "100vh", color: "#e2e2e2", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, margin: 0, background: "linear-gradient(135deg, #6366f1, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          CRM Admin Settings
        </h1>
        <Link 
          href="/dashboard/admin/channels"
          style={{
            padding: "0.5rem 1.5rem",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600
          }}
        >
          Manage Channels
        </Link>
      </div>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "1rem" }}>
        {(["tags", "fields", "replies"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "0.5rem 1.5rem",
              background: activeTab === tab ? "rgba(99, 102, 241, 0.1)" : "transparent",
              color: activeTab === tab ? "#818cf8" : "rgba(255,255,255,0.5)",
              border: "none",
              borderRadius: "20px",
              cursor: "pointer",
              fontWeight: 600,
              transition: "all 0.2s"
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ background: "#111113", padding: "2rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        
        {activeTab === "tags" && (
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "1.5rem", color: "#fff" }}>Manage Tags</h2>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
              <input 
                type="text" 
                placeholder="New tag name..." 
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  outline: "none"
                }}
              />
              <button 
                onClick={handleCreateTag}
                style={{
                  padding: "0.75rem 1.5rem",
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Create Tag
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {tags.map(tag => (
                <span key={tag.id} style={{ padding: "6px 12px", background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.2)", borderRadius: "16px", color: "#818cf8", fontSize: "0.9em", fontWeight: 500 }}>
                  {tag.name}
                </span>
              ))}
              {tags.length === 0 && <p style={{ opacity: 0.5 }}>No tags created yet.</p>}
            </div>
          </div>
        )}

        {activeTab === "replies" && (
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "1.5rem", color: "#fff" }}>Manage Quick Replies</h2>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
              <input 
                type="text" 
                placeholder="Shortcut (e.g. 'hello')" 
                value={newShortcut}
                onChange={e => setNewShortcut(e.target.value)}
                style={{
                  width: "200px",
                  padding: "0.75rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  outline: "none"
                }}
              />
              <input 
                type="text" 
                placeholder="Full message body..." 
                value={newBody}
                onChange={e => setNewBody(e.target.value)}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  outline: "none"
                }}
              />
              <button 
                onClick={handleCreateReply}
                style={{
                  padding: "0.75rem 1.5rem",
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Create Reply
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {replies.map(reply => (
                <div key={reply.id} style={{ display: "flex", gap: "2rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ color: "#818cf8", fontWeight: 600, width: "150px" }}>/{reply.shortcut}</span>
                  <span style={{ color: "#ccc" }}>{reply.body}</span>
                </div>
              ))}
              {replies.length === 0 && <p style={{ opacity: 0.5 }}>No quick replies created yet.</p>}
            </div>
          </div>
        )}

        {activeTab === "fields" && (
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "1.5rem", color: "#fff" }}>Custom Fields</h2>
            <p style={{ opacity: 0.6 }}>Coming soon. Create structured custom fields to enrich contact profiles.</p>
          </div>
        )}

      </div>
    </div>
  );
}
