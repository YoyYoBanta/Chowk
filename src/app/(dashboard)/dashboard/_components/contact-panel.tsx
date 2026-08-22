"use client";

import { useState, useEffect } from "react";
import type { ConversationStatus } from "@prisma/client";
import type { ConversationDetailDTO } from "../../_lib/types";

/** M8: client-side shape of one row from GET /api/contacts/:id/notes. */
interface NoteDTO {
  id: string;
  body: string;
  createdAt: string;
}

export function ContactPanel({ conversation }: { conversation: ConversationDetailDTO }) {
  const { contact, id: conversationId } = conversation;

  const [activeTab, setActiveTab] = useState<"details" | "notes">("details");
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [newNote, setNewNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState(conversation.status);

  // In a real app we'd fetch users, tags, custom fields here.
  // For now, we stub the options and focus on the UI to demonstrate the CRM layer capabilities.

  useEffect(() => {
    fetch(`/api/contacts/${contact.id}/notes`)
      .then(res => res.json())
      .then(data => {
        if (data.notes) setNotes(data.notes);
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

            {/* Tags — UI wiring to the real /api/contacts/:id/tags routes
                (already implemented, see src/app/api/contacts/[id]/tags/)
                is still open; this panel doesn't fetch or render real tags
                yet. An honest placeholder, not fabricated sample data — see
                the same "none yet" convention M3's read-only panel used
                before tags/notes existed at all. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>Tags</label>
              <p style={{ margin: 0, fontSize: "0.85em", opacity: 0.5 }}>Not wired up in this panel yet.</p>
            </div>

            {/* Custom Fields — same gap as Tags above: the data layer and
                API routes exist (src/data/custom-fields.ts), this panel
                just doesn't read/render them yet. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>Custom Fields</label>
              <p style={{ margin: 0, fontSize: "0.85em", opacity: 0.5 }}>Not wired up in this panel yet.</p>
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
