"use client";

import { useState, useEffect } from "react";
import type { ConversationStatus, FieldType } from "@prisma/client";
import type { ConversationDetailDTO } from "../../_lib/types";

/** M8: client-side shape of one row from GET /api/contacts/:id/notes. */
interface NoteDTO {
  id: string;
  body: string;
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
      width: "320px", 
      borderLeft: "1px solid rgba(255,255,255,0.08)", 
      background: "linear-gradient(180deg, #111113 0%, #0d0d0f 100%)",
      color: "#e2e2e2",
      display: "flex",
      flexDirection: "column",
      boxShadow: "-8px 0 24px rgba(0,0,0,0.2)",
      fontFamily: "'Inter', system-ui, sans-serif"
    }}>
      {/* Header */}
      <div style={{ padding: "1.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ 
            width: "48px", 
            height: "48px", 
            borderRadius: "50%", 
            background: "linear-gradient(135deg, #6366f1, #a855f7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.2em",
            fontWeight: 600,
            color: "#fff",
            boxShadow: "0 4px 12px rgba(168, 85, 247, 0.4)"
          }}>
            {(contact.displayName ?? contact.name ?? "U").charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: "1.1em", fontWeight: 600, margin: 0, color: "#fff" }}>
              {contact.displayName ?? contact.name ?? contact.waId}
            </h2>
            <p style={{ margin: 0, fontSize: "0.85em", opacity: 0.6, marginTop: "4px" }}>
              +{contact.waId}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {(["details", "notes"] as const).map(tab => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              padding: "1rem",
              color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.5)",
              fontWeight: activeTab === tab ? 600 : 400,
              borderBottom: activeTab === tab ? "2px solid #a855f7" : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.2s ease",
              textTransform: "capitalize"
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
        {activeTab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* Status & Assignment */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>Status</label>
              <select
                value={status}
                onChange={(e) => void handleStatusChange(e.target.value as ConversationStatus)}
                style={{
                  padding: "0.75rem",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                  outline: "none",
                  cursor: "pointer"
                }}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>Assigned to</label>
              <select
                value={assignedUserId ?? ""}
                onChange={(e) => void handleAssigneeChange(e.target.value)}
                style={{
                  padding: "0.75rem",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                  outline: "none",
                  cursor: "pointer"
                }}
              >
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            {/* Tags — real data now: fetched from /api/contacts/:id/tags,
                added/removed through the existing POST/DELETE routes. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>Tags</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {contactTags.map(tag => (
                  <span
                    key={tag.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      background: "rgba(99, 102, 241, 0.12)",
                      border: "1px solid rgba(99, 102, 241, 0.25)",
                      borderRadius: "14px",
                      color: "#a5b4fc",
                      fontSize: "0.85em",
                    }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => void handleRemoveTag(tag.id)}
                      aria-label={`Remove ${tag.name}`}
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: "0.9em", opacity: 0.7 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {contactTags.length === 0 && (
                  <span style={{ fontSize: "0.85em", opacity: 0.4 }}>No tags yet.</span>
                )}
              </div>
              {allTags.length > 0 && (
                <select
                  value={tagPickerValue}
                  onChange={(e) => void handleAddTag(e.target.value)}
                  style={{
                    padding: "0.6rem",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff",
                    outline: "none",
                    cursor: "pointer"
                  }}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>Custom Fields</label>
              {customFieldError && (
                <p style={{ margin: 0, fontSize: "0.8em", color: "#f87171" }}>{customFieldError}</p>
              )}
              {fieldDefs.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.85em", opacity: 0.5 }}>No custom fields defined for this organization yet.</p>
              ) : (
                fieldDefs.map(def => (
                  <div key={def.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    <label htmlFor={`cf-${def.key}`} style={{ fontSize: "0.75em", opacity: 0.6 }}>{def.label}</label>
                    {def.type === "LIST" && def.options ? (
                      <select
                        id={`cf-${def.key}`}
                        value={typeof customFields[def.key] === "string" ? (customFields[def.key] as string) : ""}
                        onChange={(e) => void handleCustomFieldChange(def.key, e.target.value)}
                        style={{
                          padding: "0.6rem",
                          borderRadius: "8px",
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#fff",
                          outline: "none",
                        }}
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
                        style={{
                          padding: "0.6rem",
                          borderRadius: "8px",
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#fff",
                          outline: "none",
                        }}
                      />
                    )}
                  </div>
                ))
              )}
            </div>

          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <textarea 
                placeholder="Leave a private note..." 
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                rows={3}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  color: "#fff",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit"
                }}
              />
              <button 
                onClick={handleAddNote}
                disabled={isSubmitting || !newNote.trim()}
                style={{
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.6rem",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: (isSubmitting || !newNote.trim()) ? 0.5 : 1,
                  transition: "opacity 0.2s"
                }}
              >
                Add Note
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {notes.length === 0 ? (
                <p style={{ opacity: 0.5, fontSize: "0.85em", textAlign: "center", marginTop: "2rem" }}>No notes yet.</p>
              ) : notes.map(note => (
                <div key={note.id} style={{ 
                  background: "rgba(255,255,255,0.03)", 
                  padding: "1rem", 
                  borderRadius: "8px",
                  borderLeft: "3px solid #6366f1"
                }}>
                  <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9em", lineHeight: 1.4 }}>{note.body}</p>
                  <span style={{ fontSize: "0.7em", opacity: 0.5 }}>
                    {new Date(note.createdAt).toLocaleString()}
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
