"use client";

import { useState, useEffect } from "react";
import type { ConversationStatus, FieldType } from "@prisma/client";
import type { ConversationDetailDTO } from "../../_lib/types";

/** M8: client-side shape of one row from GET /api/contacts/:id/notes.
 * authorName is resolved server-side (Note.authorUserId is a plain
 * scalar, not an enforced relation — see the route's own doc comment). */
interface NoteDTO {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

interface TagDTO {
  id: string;
  name: string;
  color: string | null;
}

interface CustomFieldDefDTO {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[] | null;
}

interface UserDTO {
  id: string;
  name: string;
  email: string;
}

export function ContactPanel({ conversation }: { conversation: ConversationDetailDTO }) {
  const { contact, id: conversationId } = conversation;

  const [activeTab, setActiveTab] = useState<"details" | "notes">("details");
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [newNote, setNewNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState(conversation.status);

  const [displayName, setDisplayName] = useState(contact.displayName ?? "");
  const [isEditingName, setIsEditingName] = useState(false);

  const [contactTags, setContactTags] = useState<TagDTO[]>([]);
  const [allTags, setAllTags] = useState<TagDTO[]>([]);
  const [tagPickerValue, setTagPickerValue] = useState("");

  const [fieldDefs, setFieldDefs] = useState<CustomFieldDefDTO[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(contact.customFields ?? {});
  const [customFieldError, setCustomFieldError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserDTO[]>([]);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(conversation.assignedUserId);

  useEffect(() => {
    fetch(`/api/contacts/${contact.id}/notes`)
      .then(res => res.json())
      .then(data => {
        if (data.notes) setNotes(data.notes);
      })
      .catch(console.error);

    fetch(`/api/contacts/${contact.id}/tags`)
      .then(res => res.json())
      .then(data => {
        if (data.tags) setContactTags(data.tags);
      })
      .catch(console.error);

    fetch("/api/tags")
      .then(res => res.json())
      .then(data => {
        if (data.tags) setAllTags(data.tags);
      })
      .catch(console.error);

    fetch("/api/custom-field-definitions")
      .then(res => res.json())
      .then(data => {
        if (data.definitions) setFieldDefs(data.definitions);
      })
      .catch(console.error);

    fetch("/api/users")
      .then(res => res.json())
      .then(data => {
        if (data.users) setUsers(data.users);
      })
      .catch(console.error);
  }, [contact.id]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newNote }),
      });
      const data = await res.json();
      if (data.note) {
        setNotes([data.note, ...notes]);
        setNewNote("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: ConversationStatus) => {
    setStatus(newStatus);
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const handleSaveName = async () => {
    setIsEditingName(false);
    const trimmed = displayName.trim();
    // Empty clears the override, falling back to the provider-supplied
    // `contact.name` — matches updateContact's own `displayName?: string
    // | null` contract (src/data/contacts.ts).
    setDisplayName(trimmed);
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: trimmed || null }),
    });
  };

  const handleAssigneeChange = async (newAssignedUserId: string) => {
    const value = newAssignedUserId === "" ? null : newAssignedUserId;
    setAssignedUserId(value);
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedUserId: value }),
    });
  };

  const handleAddTag = async (tagId: string) => {
    if (!tagId || contactTags.some(t => t.id === tagId)) return;
    const tag = allTags.find(t => t.id === tagId);
    if (!tag) return;
    setContactTags([...contactTags, tag]);
    setTagPickerValue("");
    await fetch(`/api/contacts/${contact.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    });
  };

  const handleRemoveTag = async (tagId: string) => {
    setContactTags(contactTags.filter(t => t.id !== tagId));
    await fetch(`/api/contacts/${contact.id}/tags/${tagId}`, { method: "DELETE" });
  };

  const handleCustomFieldChange = async (key: string, value: string) => {
    const previous = customFields;
    const next = { ...customFields, [key]: value };
    setCustomFields(next);
    setCustomFieldError(null);

    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFields: next }),
    });

    if (!res.ok) {
      // Server-side type validation rejected this value (a defense-in-depth
      // check — the NUMBER/DATE inputs already constrain most bad input at
      // the browser level, but a direct API call could still send anything).
      // Revert to the last known-good value rather than leaving the UI
      // showing something that was never actually saved.
      setCustomFields(previous);
      const data = await res.json().catch(() => null);
      const reason = data?.fieldErrors?.[key] ?? data?.error ?? "Couldn't save that value.";
      setCustomFieldError(reason);
    }
  };

  return (
    <aside style={{
      width: "300px",
      flexShrink: 0,
      borderLeft: "1px solid var(--border)",
      background: "var(--surface)",
      color: "var(--text-primary)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ padding: "var(--space-4)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div style={{
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "var(--accent)",
            flexShrink: 0,
          }}>
            {(displayName || contact.name || "U").charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            {isEditingName ? (
              <input
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => void handleSaveName()}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                placeholder={contact.name ?? contact.waId}
                style={{ fontSize: "0.95rem", fontWeight: 700, background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "2px 6px", color: "var(--text-primary)", outline: "none", width: "100%" }}
              />
            ) : (
              <h2
                onClick={() => setIsEditingName(true)}
                title="Click to rename"
                style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, color: "var(--text-primary)", cursor: "pointer" }}
              >
                {displayName || contact.name || contact.waId}
              </h2>
            )}
            <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
              +{contact.waId}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["details", "notes"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              padding: "var(--space-3)",
              color: activeTab === tab ? "var(--text-primary)" : "var(--text-muted)",
              fontWeight: activeTab === tab ? 700 : 500,
              fontSize: "0.85rem",
              borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)" }}>
        {activeTab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>

            {/* Status & Assignment */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <label style={fieldLabelStyle}>Status</label>
              <select
                value={status}
                onChange={(e) => void handleStatusChange(e.target.value as ConversationStatus)}
                style={selectStyle}
              >
                {/* Matches context.md §7.3's real ConversationStatus enum
                    exactly (OPEN | DONE) — the previous CLOSED/SNOOZED
                    options here didn't exist in the schema and would have
                    failed the PATCH request with an invalid enum value. */}
                <option value="OPEN">Open</option>
                <option value="DONE">Done</option>
              </select>
            </div>

            {/* Assignment — the "Mine"/"Unassigned" list filters already
                existed with no UI anywhere to actually assign a
                conversation to someone. Wired to the same PATCH
                /api/conversations/:id the status select above uses. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <label style={fieldLabelStyle}>Assigned to</label>
              <select
                value={assignedUserId ?? ""}
                onChange={(e) => void handleAssigneeChange(e.target.value)}
                style={selectStyle}
              >
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            {/* Tags — real data now: fetched from /api/contacts/:id/tags,
                added/removed through the existing POST/DELETE routes. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <label style={fieldLabelStyle}>Tags</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {contactTags.map(tag => (
                  <span
                    key={tag.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      background: "var(--accent-soft)",
                      border: "1px solid var(--accent-soft-border)",
                      borderRadius: "var(--radius-full)",
                      color: "var(--accent)",
                      fontSize: "0.8rem",
                    }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => void handleRemoveTag(tag.id)}
                      aria-label={`Remove ${tag.name}`}
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: "0.9rem", opacity: 0.75 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {contactTags.length === 0 && (
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No tags yet.</span>
                )}
              </div>
              {allTags.length > 0 && (
                <select
                  value={tagPickerValue}
                  onChange={(e) => void handleAddTag(e.target.value)}
                  style={selectStyle}
                >
                  <option value="" disabled>Add a tag…</option>
                  {allTags
                    .filter(t => !contactTags.some(ct => ct.id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
              )}
            </div>

            {/* Custom Fields — real data now: definitions come from
                /api/custom-field-definitions (org-wide), values live on
                Contact.customFields (a plain Json column, keyed by
                definition.key) and save through PATCH /api/contacts/:id
                (which validates each value against its declared FieldType
                server-side — see src/lib/custom-fields/validate.ts). */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <label style={fieldLabelStyle}>Custom Fields</label>
              {customFieldError && (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--danger)" }}>{customFieldError}</p>
              )}
              {fieldDefs.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>No custom fields defined for this organization yet.</p>
              ) : (
                fieldDefs.map(def => (
                  <div key={def.id} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    <label htmlFor={`cf-${def.key}`} style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{def.label}</label>
                    {def.type === "LIST" && def.options ? (
                      <select
                        id={`cf-${def.key}`}
                        value={typeof customFields[def.key] === "string" ? (customFields[def.key] as string) : ""}
                        onChange={(e) => void handleCustomFieldChange(def.key, e.target.value)}
                        style={selectStyle}
                      >
                        <option value="">—</option>
                        {def.options.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`cf-${def.key}`}
                        type={def.type === "NUMBER" ? "number" : def.type === "DATE" ? "date" : "text"}
                        value={typeof customFields[def.key] === "string" || typeof customFields[def.key] === "number" ? String(customFields[def.key]) : ""}
                        onChange={(e) => void handleCustomFieldChange(def.key, e.target.value)}
                        style={inputStyle}
                      />
                    )}
                  </div>
                ))
              )}
            </div>

          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <textarea
                placeholder="Leave a private note…"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
              <button
                onClick={handleAddNote}
                disabled={isSubmitting || !newNote.trim()}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.55rem",
                  color: "var(--text-on-accent)",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  opacity: (isSubmitting || !newNote.trim()) ? 0.5 : 1,
                }}
              >
                Add Note
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {notes.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", marginTop: "var(--space-5)" }}>No notes yet.</p>
              ) : notes.map(note => (
                <div key={note.id} style={{
                  background: "var(--bg)",
                  padding: "var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  borderLeft: "3px solid var(--accent)",
                }}>
                  <p style={{ margin: "0 0 0.4rem 0", fontSize: "0.88rem", lineHeight: 1.4, color: "var(--text-primary)" }}>{note.body}</p>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                    {note.authorName} &middot; {new Date(note.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const fieldLabelStyle = {
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
  fontWeight: 600,
} as const;

const selectStyle = {
  padding: "0.6rem",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  outline: "none",
  cursor: "pointer",
  fontSize: "0.85rem",
} as const;

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "0.6rem",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: "0.85rem",
} as const;
