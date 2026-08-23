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

type Role = "ADMIN" | "AGENT";

interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"tags" | "fields" | "replies" | "templates" | "users">("tags");

  const [tags, setTags] = useState<TagDTO[]>([]);
  const [newTag, setNewTag] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");

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
  const [newTemplateChannelId, setNewTemplateChannelId] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateLanguage, setNewTemplateLanguage] = useState("en_US");
  const [newTemplateCategory, setNewTemplateCategory] = useState("UTILITY");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [createTemplateError, setCreateTemplateError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserDTO[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("AGENT");
  const [invitedCredential, setInvitedCredential] = useState<{ email: string; password: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

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

    fetch("/api/users").then(res => res.json()).then(data => {
      if (data.users) setUsers(data.users);
    }).catch(console.error);
  }, []);

  const handleInviteUser = async () => {
    setInviteError(null);
    if (!newUserEmail.trim() || !newUserName.trim()) return;
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newUserEmail.trim(), name: newUserName.trim(), role: newUserRole }),
    });
    const data = await res.json();
    if (!res.ok) {
      setInviteError(data.error ?? "Couldn't invite that user.");
      return;
    }
    setUsers([...users, data.user]);
    setInvitedCredential({ email: data.user.email, password: data.temporaryPassword });
    setNewUserEmail("");
    setNewUserName("");
    setNewUserRole("AGENT");
  };

  const handleChangeRole = async (userId: string, role: Role) => {
    const previous = users;
    setUsers(users.map(u => (u.id === userId ? { ...u, role } : u)));
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    // Revert on rejection (e.g. an admin can't change their own role —
    // see PATCH /api/users/:id) rather than leave the UI showing a change
    // that never actually saved.
    if (!res.ok) setUsers(previous);
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    const previous = users;
    setUsers(users.map(u => (u.id === userId ? { ...u, isActive } : u)));
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) setUsers(previous);
  };

  const refreshTemplates = async () => {
    const byChannel: Record<string, TemplateDTO[]> = {};
    await Promise.all(channels.map(async (c) => {
      const res = await fetch(`/api/templates?channelId=${c.id}`);
      const tData = await res.json();
      byChannel[c.id] = tData.templates ?? [];
    }));
    setTemplatesByChannel(byChannel);
  };

  const handleSyncTemplates = async () => {
    setIsSyncing(true);
    try {
      await fetch("/api/templates/sync", { method: "POST" });
      await refreshTemplates();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateTemplate = async () => {
    setCreateTemplateError(null);
    if (!newTemplateChannelId || !newTemplateName.trim() || !newTemplateLanguage.trim() || !newTemplateCategory.trim() || !newTemplateBody.trim()) {
      setCreateTemplateError("All fields are required.");
      return;
    }
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: newTemplateChannelId,
        name: newTemplateName.trim(),
        languageCode: newTemplateLanguage.trim(),
        category: newTemplateCategory.trim(),
        body: newTemplateBody.trim(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setCreateTemplateError(data?.error ?? "Couldn't create that template.");
      return;
    }
    setNewTemplateName("");
    setNewTemplateLanguage("");
    setNewTemplateCategory("");
    setNewTemplateBody("");
    await refreshTemplates();
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

  const handleStartRenameTag = (tag: TagDTO) => {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
  };

  const handleSaveRenameTag = async (tagId: string) => {
    const name = editingTagName.trim();
    setEditingTagId(null);
    if (!name) return;
    setTags(tags.map(t => (t.id === tagId ? { ...t, name } : t)));
    await fetch(`/api/tags/${tagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  const handleDeleteTag = async (tagId: string) => {
    setTags(tags.filter(t => t.id !== tagId));
    await fetch(`/api/tags/${tagId}`, { method: "DELETE" });
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
        {(["users", "tags", "fields", "replies", "templates"] as const).map(tab => (
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

        {activeTab === "users" && (
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "1.5rem", color: "#fff" }}>Users</h2>

            {invitedCredential && (
              <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "rgba(74, 222, 128, 0.08)", border: "1px solid rgba(74, 222, 128, 0.25)", borderRadius: "8px" }}>
                <p style={{ margin: 0, fontSize: "0.85em", color: "#4ade80" }}>
                  Invited <strong>{invitedCredential.email}</strong>. Temporary password (share this with them
                  directly — it won&apos;t be shown again): <code style={{ background: "rgba(0,0,0,0.3)", padding: "2px 8px", borderRadius: "4px" }}>{invitedCredential.password}</code>
                </p>
              </div>
            )}
            {inviteError && (
              <p style={{ margin: "0 0 1rem", fontSize: "0.85em", color: "#f87171" }}>{inviteError}</p>
            )}

            <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Name"
                value={newUserName}
                onChange={e => setNewUserName(e.target.value)}
                style={{ width: "180px", padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
              />
              <input
                type="email"
                placeholder="Email"
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
                style={{ flex: 1, minWidth: "180px", padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
              />
              <select
                value={newUserRole}
                onChange={e => setNewUserRole(e.target.value as Role)}
                style={{ padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
              >
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
              <button
                onClick={() => void handleInviteUser()}
                style={{ padding: "0.75rem 1.5rem", background: "linear-gradient(135deg, #6366f1, #a855f7)", border: "none", borderRadius: "8px", color: "#fff", fontWeight: 600, cursor: "pointer" }}
              >
                Invite
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {users.map(u => (
                <div key={u.id} style={{ display: "flex", gap: "1rem", alignItems: "center", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", opacity: u.isActive ? 1 : 0.5 }}>
                  <div style={{ minWidth: "220px" }}>
                    <div style={{ color: "#fff", fontWeight: 500 }}>{u.name}</div>
                    <div style={{ fontSize: "0.8em", opacity: 0.6 }}>{u.email}</div>
                  </div>
                  <select
                    value={u.role}
                    onChange={e => void handleChangeRole(u.id, e.target.value as Role)}
                    style={{ padding: "0.5rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fff", outline: "none" }}
                  >
                    <option value="AGENT">Agent</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <span style={{ fontSize: "0.8em", padding: "2px 10px", borderRadius: "12px", background: "rgba(255,255,255,0.06)", color: u.isActive ? "#4ade80" : "#f87171" }}>
                    {u.isActive ? "Active" : "Deactivated"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(u.id, !u.isActive)}
                    style={{ marginLeft: "auto", padding: "0.5rem 1rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fff", cursor: "pointer", fontSize: "0.85em" }}
                  >
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              ))}
              {users.length === 0 && <p style={{ opacity: 0.5 }}>No users yet.</p>}
            </div>
          </div>
        )}

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
                <span
                  key={tag.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 12px", background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.2)", borderRadius: "16px", color: "#818cf8", fontSize: "0.9em", fontWeight: 500 }}
                >
                  {editingTagId === tag.id ? (
                    <input
                      autoFocus
                      value={editingTagName}
                      onChange={e => setEditingTagName(e.target.value)}
                      onBlur={() => void handleSaveRenameTag(tag.id)}
                      onKeyDown={e => e.key === "Enter" && handleSaveRenameTag(tag.id)}
                      style={{ width: "100px", padding: "2px 6px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", color: "#fff", outline: "none", fontSize: "inherit" }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStartRenameTag(tag)}
                      title="Rename"
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, font: "inherit" }}
                    >
                      {tag.name}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteTag(tag.id)}
                    aria-label={`Delete ${tag.name}`}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: "0.9em", opacity: 0.6 }}
                  >
                    ×
                  </button>
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

            {channels.length > 0 && (
              <div style={{ marginBottom: "2rem", padding: "1.25rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "rgba(255,255,255,0.6)", marginTop: 0, marginBottom: "1rem" }}>Create a template</h3>
                {createTemplateError && (
                  <p style={{ margin: "0 0 0.75rem", fontSize: "0.85em", color: "#f87171" }}>{createTemplateError}</p>
                )}
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                  <select
                    value={newTemplateChannelId}
                    onChange={e => setNewTemplateChannelId(e.target.value)}
                    style={{ padding: "0.6rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  >
                    <option value="" disabled>Channel…</option>
                    {channels.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="Name (e.g. order_update)"
                    value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    style={{ width: "200px", padding: "0.6rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  />
                  <input
                    type="text"
                    placeholder="Language (e.g. en_US)"
                    value={newTemplateLanguage}
                    onChange={e => setNewTemplateLanguage(e.target.value)}
                    style={{ width: "140px", padding: "0.6rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  />
                  <select
                    value={newTemplateCategory}
                    onChange={e => setNewTemplateCategory(e.target.value)}
                    style={{ padding: "0.6rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  >
                    <option value="UTILITY">Utility</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </select>
                </div>
                <textarea
                  placeholder="Body — use {{1}}, {{2}}, ... for variables"
                  value={newTemplateBody}
                  onChange={e => setNewTemplateBody(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                />
                <button
                  onClick={() => void handleCreateTemplate()}
                  style={{ marginTop: "0.75rem", padding: "0.6rem 1.25rem", background: "linear-gradient(135deg, #6366f1, #a855f7)", border: "none", borderRadius: "8px", color: "#fff", fontWeight: 600, cursor: "pointer" }}
                >
                  Create &amp; submit
                </button>
              </div>
            )}

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
