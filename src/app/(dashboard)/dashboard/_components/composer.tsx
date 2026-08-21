"use client";

import { useEffect, useState } from "react";
import { formatDurationShort } from "@/lib/format/duration";
import type { MessageDTO } from "../../_lib/types";

/**
 * Text composer (context.md §10.4) — the milestone's most important
 * component (M5's own brief). Two mutually exclusive states, driven
 * ENTIRELY by server-provided window state (`isWindowOpen`/`closesAt`,
 * computed by the conversation-detail page/route via
 * src/services/window.ts on every request) — never recomputed here from a
 * possibly-stale `lastInboundAt`. This is deliberate: the send endpoint
 * itself (`POST /api/conversations/:id/messages`) checks the identical
 * server-side window state before accepting a send
 * (src/services/messages/send-message.ts), so there must be no gap between
 * what this component shows and what the API will actually do — an agent
 * must never be able to type a long message and only discover on send that
 * it was rejected.
 *
 * - **Window open**: the free-text input works exactly as it did in M4,
 *   plus a small "Window closes in Xh Ym" countdown line.
 * - **Window closed**: the free-text input is disabled outright, with a
 *   plain-English explanation and a disabled "Send a template" placeholder
 *   button — templates themselves don't exist until M7, so this is
 *   deliberately not a working picker, just a clearly-labeled future
 *   action.
 *
 * Sends via `POST /api/conversations/:id/messages`
 * (src/app/api/conversations/[id]/messages/route.ts).
 *
 * Optimistic UX (unchanged from M4): an optimistic `PENDING` row is added
 * to the thread the instant the agent hits send, reconciled once the
 * server responds — `onServerAck` replaces the temporary row with the
 * real, server-returned one; `onFailed` marks the optimistic row FAILED in
 * place if the request itself never reached the server, or the server
 * rejected it (including a 409 window-closed rejection reaching this
 * component despite the disabled state above — e.g. a stale page that
 * hasn't refetched since the window closed).
 */
export function Composer({
  conversationId,
  isWindowOpen,
  closesAt,
  onOptimisticAdd,
  onServerAck,
  onFailed,
}: {
  conversationId: string;
  /** Server-computed (src/services/window.ts), never derived here. */
  isWindowOpen: boolean;
  /** ISO string of when the window closes (or closed) — display only. */
  closesAt: string | null;
  onOptimisticAdd: (message: MessageDTO) => void;
  onServerAck: (tempId: string, real: MessageDTO) => void;
  onFailed: (tempId: string, errorMessage: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async (): Promise<void> => {
    const body = text.trim();
    if (!body || sending || !isWindowOpen) return;

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
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        onFailed(tempId, data?.error ?? "please try again.");
      }
    } catch {
      onFailed(tempId, "check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (!isWindowOpen) {
    return <ClosedWindowComposer />;
  }

  return (
    <div>
      <WindowCountdown closesAt={closesAt} />
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
    </div>
  );
}

/**
 * Closed-window state (context.md §4.1/§10.4): free text is unavailable,
 * only an approved template could reopen this conversation to a free-form
 * reply. Templates don't exist as a model or a send path until M7 — this
 * button is a disabled, clearly-labeled placeholder, not a working picker,
 * per this milestone's explicit non-goal ("don't half-build M7's scope").
 */
function ClosedWindowComposer() {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border, #e5e5e5)",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.9em", opacity: 0.8 }}>
        The 24-hour reply window has closed. You can only send an approved template message.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <textarea
          value=""
          disabled
          placeholder="Free-text replies are unavailable until the contact messages again"
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            padding: "0.5rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--border, #e5e5e5)",
            font: "inherit",
            opacity: 0.6,
          }}
        />
        <button type="button" disabled title="Template sending arrives in a later milestone">
          Send a template
        </button>
      </div>
    </div>
  );
}

/**
 * "Window closes in Xh Ym" (context.md §10.4). `closesAt` is a fixed
 * absolute instant the server computed from the real `lastInboundAt` — the
 * countdown below re-renders it every 30s purely to keep the displayed
 * text fresh as real time passes; it never re-derives the open/closed
 * boolean itself (that stays exactly what the server said until the page's
 * data is refetched), so this is pure display, not enforcement.
 */
function WindowCountdown({ closesAt }: { closesAt: string | null }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!closesAt) return null;
  const remainingMs = new Date(closesAt).getTime() - now.getTime();
  if (remainingMs <= 0) return null;

  return (
    <p style={{ margin: "0 0.75rem", fontSize: "0.8em", opacity: 0.6 }}>
      Window closes in {formatDurationShort(remainingMs)}
    </p>
  );
}
