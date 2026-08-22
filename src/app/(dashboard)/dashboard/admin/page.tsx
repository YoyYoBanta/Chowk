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

type FieldType = "TEXT" | "NUMBER" | "DATE" | "LIST";

interface CustomFieldDefDTO {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[] | null;
}

interface ChannelDTO {
  id: string;
  displayName: string;
}

interface TemplateDTO {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectionReason: string | null;
  lastSyncedAt: string | null;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"tags" | "fields" | "replies" | "templates">("tags");

  const [tags, setTags] = useState<TagDTO[]>([]);
  const [newTag, setNewTag] = useState("");

  const [replies, setReplies] = useState<QuickReplyDTO[]>([]);
  const [newShortcut, setNewShortcut] = useState("");
  const [newBody, setNewBody] = useState("");

  const [fieldDefs, setFieldDefs] = useState<CustomFieldDefDTO[]>([]);
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldType>("TEXT");
  const [newFieldOptions, setNewFieldOptions] = useState("");

  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [templatesByChannel, setTemplatesByChannel] = useState<Record<string, TemplateDTO[]>>({});
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/tags").then(res => res.json()).then(data => {
      if (data.tags) setTags(data.tags);
    }).catch(console.error);

    fetch("/api/quick-replies").then(res => res.json()).then(data => {
      if (data.quickReplies) setReplies(data.quickReplies);
    }).catch(console.error);

    fetch("/api/custom-field-definitions").then(res => res.json()).then(data => {
      if (data.definitions) setFieldDefs(data.definitions);
    }).catch(console.error);

    fetch("/api/channels").then(res => res.json()).then(async (data) => {
      const chans: ChannelDTO[] = data.channels ?? [];
      setChannels(chans);
      const byChannel: Record<string, TemplateDTO[]> = {};
      await Promise.all(chans.map(async (c) => {
        const res = await fetch(`/api/templates?channelId=${c.id}`);
        const tData = await res.json();
        byChannel[c.id] = tData.templates ?? [];
      }));
      setTemplatesByChannel(byChannel);
    }).catch(console.error);
  }, []);

  const handleSyncTemplates = async () => {
    setIsSyncing(true);
    try {
      await fetch("/api/templates/sync", { method: "POST" });
      const byChannel: Record<string, TemplateDTO[]> = {};
      await Promise.all(channels.map(async (c) => {
        const res = await fetch(`/api/templates?channelId=${c.id}`);
        const tData = await res.json();
        byChannel[c.id] = tData.templates ?? [];
      }));
      setTemplatesByChannel(byChannel);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateField = async () => {
    if (!newFieldKey.trim() || !newFieldLabel.trim()) return;
    const options = newFieldType === "LIST"
      ? newFieldOptions.split(",").map(o => o.trim()).filter(Boolean)
      : undefined;
    const res = await fetch("/api/custom-field-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: newFieldKey.trim(), label: newFieldLabel.trim(), type: newFieldType, options }),
    });
    const data = await res.json();
    if (data.definition) {
      setFieldDefs([...fieldDefs, data.definition]);
      setNewFieldKey("");
      setNewFieldLabel("");
      setNewFieldType("TEXT");
      setNewFieldOptions("");
    }
  };

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
        {(["tags", "fields", "replies", "templates"] as const).map(tab => (
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
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Key (e.g. company)"
                value={newFieldKey}
                onChange={e => setNewFieldKey(e.target.value)}
                style={{ width: "160px", padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
              />
              <input
                type="text"
                placeholder="Label (e.g. Company)"
                value={newFieldLabel}
                onChange={e => setNewFieldLabel(e.target.value)}
                style={{ flex: 1, minWidth: "160px", padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
              />
              <select
                value={newFieldType}
                onChange={e => setNewFieldType(e.target.value as FieldType)}
                style={{ padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
              >
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
                <option value="DATE">Date</option>
                <option value="LIST">List</option>
              </select>
              {newFieldType === "LIST" && (
                <input
                  type="text"
                  placeholder="Options, comma-separated"
                  value={newFieldOptions}
                  onChange={e => setNewFieldOptions(e.target.value)}
                  style={{ flex: 1, minWidth: "160px", padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
                />
              )}
              <button
                onClick={handleCreateField}
                style={{ padding: "0.75rem 1.5rem", background: "linear-gradient(135deg, #6366f1, #a855f7)", border: "none", borderRadius: "8px", color: "#fff", fontWeight: 600, cursor: "pointer" }}
              >
                Create Field
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {fieldDefs.map(def => (
                <div key={def.id} style={{ display: "flex", gap: "1rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", alignItems: "center" }}>
                  <span style={{ color: "#818cf8", fontWeight: 600, width: "160px" }}>{def.label}</span>
                  <code style={{ opacity: 0.6, fontSize: "0.85em" }}>{def.key}</code>
                  <span style={{ marginLeft: "auto", fontSize: "0.8em", padding: "2px 10px", borderRadius: "12px", background: "rgba(255,255,255,0.06)", opacity: 0.8 }}>{def.type}</span>
                </div>
              ))}
              {fieldDefs.length === 0 && <p style={{ opacity: 0.5 }}>No custom fields created yet.</p>}
            </div>
          </div>
        )}

        {activeTab === "templates" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: 0, color: "#fff" }}>Message Templates</h2>
              <button
                onClick={() => void handleSyncTemplates()}
                disabled={isSyncing}
                style={{
                  padding: "0.6rem 1.25rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: isSyncing ? "default" : "pointer",
                  opacity: isSyncing ? 0.6 : 1,
                }}
              >
                {isSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {channels.length === 0 && <p style={{ opacity: 0.5 }}>No channels connected yet.</p>}
            {channels.map(channel => {
              const templates = templatesByChannel[channel.id] ?? [];
              return (
                <div key={channel.id} style={{ marginBottom: "2rem" }}>
                  <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: "0.75rem" }}>{channel.displayName}</h3>
                  {templates.length === 0 ? (
                    <p style={{ opacity: 0.5, fontSize: "0.9em" }}>No templates synced for this channel yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {templates.map(t => {
                        const statusColor =
                          t.status === "APPROVED" ? "#4ade80"
                          : t.status === "REJECTED" ? "#f87171"
                          : "#facc15";
                        return (
                          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                              <span style={{ color: "#818cf8", fontWeight: 600 }}>{t.name}</span>
                              <span style={{ opacity: 0.5, fontSize: "0.8em" }}>{t.language}</span>
                              <span style={{ opacity: 0.5, fontSize: "0.8em" }}>{t.category}</span>
                              <span style={{ marginLeft: "auto", fontSize: "0.75em", padding: "2px 10px", borderRadius: "12px", background: "rgba(255,255,255,0.06)", color: statusColor }}>
                                {t.status}
                              </span>
                            </div>
                            {t.status === "REJECTED" && t.rejectionReason && (
                              <p style={{ margin: 0, fontSize: "0.85em", color: "#f87171" }}>Rejected: {t.rejectionReason}</p>
                            )}
                            {t.lastSyncedAt && (
                              <p style={{ margin: 0, fontSize: "0.75em", opacity: 0.4 }}>
                                Last synced {new Date(t.lastSyncedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
