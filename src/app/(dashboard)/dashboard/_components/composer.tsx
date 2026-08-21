"use client";

import { useState } from "react";
import type { MessageDTO } from "../../_lib/types";

/**
 * Text composer (context.md §10.4, M4 scope only — no window-state
 * awareness yet, that's M5; no attachments/quick-replies/templates, that's
 * M6-M8). Sends via `POST /api/conversations/:id/messages`
 * (src/app/api/conversations/[id]/messages/route.ts).
 *
 * Optimistic UX: an optimistic `PENDING` row is added to the thread the
 * instant the agent hits send (never make them wait to see what they just
 * typed), reconciled once the server responds — `onServerAck` replaces the
 * temporary row with the real, server-returned one (same id every other
 * client will see over SSE from this point on); `onFailed` marks the
 * optimistic row FAILED in place if the request itself never made it to
 * the server at all (network failure) or the server rejected it outright
 * (e.g. a 404 conversation).
 */
export function Composer({
  conversationId,
  onOptimisticAdd,
  onServerAck,
  onFailed,
}: {
  conversationId: string;
  onOptimisticAdd: (message: MessageDTO) => void;
  onServerAck: (tempId: string, real: MessageDTO) => void;
  onFailed: (tempId: string, errorMessage: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async (): Promise<void> => {
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    setText("");

    const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nowIso = new Date().toISOString();
    onOptimisticAdd({
      id: tempId,
      conversationId,
      provider: "",
      providerMessageId: null,
      direction: "OUTBOUND",
      type: "TEXT",
      body,
      mediaId: null,
      templateName: null,
      status: "PENDING",
      errorCode: null,
      errorMessage: null,
      metaTimestamp: nowIso,
      createdAt: nowIso,
    });

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });

      if (res.ok) {
        const data = (await res.json()) as { message: MessageDTO };
        onServerAck(tempId, data.message);
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        onFailed(tempId, data?.error ?? "please try again.");
      }
    } catch {
      onFailed(tempId, "check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--border, #e5e5e5)",
        padding: "0.75rem",
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-end",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        placeholder="Type a message..."
        rows={2}
        disabled={sending}
        style={{
          flex: 1,
          resize: "none",
          padding: "0.5rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--border, #e5e5e5)",
          font: "inherit",
        }}
      />
      <button type="button" onClick={() => void handleSend()} disabled={sending || !text.trim()}>
        {sending ? "Sending..." : "Send"}
      </button>
    </div>
  );
}
