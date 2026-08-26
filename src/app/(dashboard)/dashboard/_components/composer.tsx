"use client";

import { useEffect, useRef, useState } from "react";
import { formatDurationShort } from "@/lib/format/duration";
import { ALL_SUPPORTED_MIME_TYPES, mediaKindForMime, messageTypeForMediaKind } from "@/services/media/limits";
import type { MessageDTO } from "../../_lib/types";
import { TemplatePicker } from "./template-picker";

function optimisticMessageType(mimeType: string): MessageDTO["type"] {
  const kind = mediaKindForMime(mimeType);
  return kind ? messageTypeForMediaKind(kind) : "DOCUMENT";
}

/** M8: client-side shape of one row from GET /api/quick-replies. */
interface QuickReplyDTO {
  id: string;
  shortcut: string;
  body: string;
  mediaId: string | null;
}

export function Composer({
  conversationId,
  channelId,
  isWindowOpen,
  closesAt,
  onOptimisticAdd,
  onServerAck,
  onFailed,
}: {
  conversationId: string;
  channelId: string;
  isWindowOpen: boolean;
  closesAt: string | null;
  onOptimisticAdd: (message: MessageDTO) => void;
  onServerAck: (tempId: string, real: MessageDTO) => void;
  onFailed: (tempId: string, errorMessage: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quick Replies State
  const [quickReplies, setQuickReplies] = useState<QuickReplyDTO[]>([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyFilter, setQuickReplyFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    fetch("/api/quick-replies")
      .then(res => res.json())
      .then(data => {
        if (data.quickReplies) setQuickReplies(data.quickReplies);
      })
      .catch(() => {});
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    
    // Check for quick reply trigger
    const match = val.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      setShowQuickReplies(true);
      setQuickReplyFilter(match[2].toLowerCase());
      setSelectedIndex(0);
    } else {
      setShowQuickReplies(false);
    }
  };

  const filteredQuickReplies = quickReplies.filter(qr => 
    qr.shortcut.toLowerCase().includes(quickReplyFilter) ||
    qr.body.toLowerCase().includes(quickReplyFilter)
  );

  const applyQuickReply = (qr: QuickReplyDTO) => {
    const match = text.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      const newText = text.substring(0, match.index) + (match[1] || "") + qr.body + " ";
      setText(newText);
    } else {
      setText(text + qr.body + " ");
    }
    setShowQuickReplies(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showQuickReplies && filteredQuickReplies.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredQuickReplies.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredQuickReplies.length) % filteredQuickReplies.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyQuickReply(filteredQuickReplies[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowQuickReplies(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSend = async (): Promise<void> => {
    const body = text.trim();
    if (!body || sending || !isWindowOpen) return;

    setSending(true);
    setText("");

    // crypto.randomUUID(), not Date.now()/Math.random() — the eslint
    // react-hooks/purity rule flags those two specific globals as "impure"
    // even from inside an event-handler closure (a false positive here,
    // since this never runs during render — only from onClick/onKeyDown —
    // but a real UUID is the better id anyway).
    const tempId = `optimistic-${crypto.randomUUID()}`;
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
      media: null,
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ""; 
    if (!file || sending || !isWindowOpen) return;

    setSending(true);

    const tempId = `optimistic-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const previewUrl = URL.createObjectURL(file);
    onOptimisticAdd({
      id: tempId,
      conversationId,
      provider: "",
      providerMessageId: null,
      direction: "OUTBOUND",
      type: optimisticMessageType(file.type),
      body: null,
      mediaId: null,
      templateName: null,
      status: "PENDING",
      errorCode: null,
      errorMessage: null,
      metaTimestamp: nowIso,
      createdAt: nowIso,
      media: { id: tempId, mimeType: file.type, fileName: file.name, sizeBytes: file.size, url: previewUrl },
    });

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });

      if (res.ok) {
        const data = (await res.json()) as { message: MessageDTO };
        onServerAck(tempId, data.message);
        URL.revokeObjectURL(previewUrl);
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

  const handleTemplateSend = async (templateName: string, languageCode: string, variables: Record<string, string>): Promise<void> => {
    if (sending) return;
    setSending(true);

    const tempId = `optimistic-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    onOptimisticAdd({
      id: tempId,
      conversationId,
      provider: "",
      providerMessageId: null,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      body: null,
      mediaId: null,
      templateName,
      status: "PENDING",
      errorCode: null,
      errorMessage: null,
      metaTimestamp: nowIso,
      createdAt: nowIso,
      media: null,
    });

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "template", templateName, languageCode, variables }),
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
    return <ClosedWindowComposer channelId={channelId} onSend={handleTemplateSend} disabled={sending} />;
  }

  // context.md §10.4: the template picker isn't only for a closed window —
  // it's "available generally via the template button when the window is
  // open" too (an agent can choose to send a template even when free text
  // still works, e.g. a structured order-update template).
  if (showTemplatePicker) {
    return (
      <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
        <TemplatePicker
          channelId={channelId}
          onSelect={(name, lang, vars) => {
            setShowTemplatePicker(false);
            void handleTemplateSend(name, lang, vars);
          }}
          onCancel={() => setShowTemplatePicker(false)}
        />
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <WindowCountdown closesAt={closesAt} />
      
      {/* Quick Replies Popup */}
      {showQuickReplies && filteredQuickReplies.length > 0 && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: "var(--space-3)",
          marginBottom: "var(--space-2)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-panel)",
          width: "300px",
          maxHeight: "250px",
          overflowY: "auto",
          zIndex: 50,
          color: "var(--text-primary)",
        }}>
          <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Quick Replies
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {filteredQuickReplies.map((qr, idx) => (
              <li
                key={qr.id}
                onClick={() => applyQuickReply(qr)}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: "var(--space-3)",
                  cursor: "pointer",
                  background: selectedIndex === idx ? "var(--accent-soft)" : "transparent",
                  borderLeft: selectedIndex === idx ? "3px solid var(--accent)" : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "0.83rem", color: "var(--accent)" }}>/{qr.shortcut}</strong>
                </div>
                <div style={{ fontSize: "0.83rem", color: "var(--text-secondary)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {qr.body}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "var(--space-3)",
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Press '/' for quick replies)"
          rows={2}
          disabled={sending}
          style={{
            flex: 1,
            resize: "none",
            padding: "0.65rem 0.75rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            color: "var(--text-primary)",
            font: "inherit",
            outline: "none",
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ALL_SUPPORTED_MIME_TYPES.join(",")}
          style={{ display: "none" }}
          onChange={(e) => void handleFileChange(e)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          title="Attach a file"
          aria-label="Attach a file"
          style={composerIconButtonStyle}
        >
          📎
        </button>
        <button
          type="button"
          onClick={() => setShowTemplatePicker(true)}
          disabled={sending}
          title="Send a template message"
          aria-label="Send a template message"
          style={composerIconButtonStyle}
        >
          📄
        </button>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || !text.trim()}
          style={{
            padding: "0.65rem 1.25rem",
            background: (sending || !text.trim()) ? "var(--surface-active)" : "var(--accent)",
            color: (sending || !text.trim()) ? "var(--text-muted)" : "var(--text-on-accent)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            fontWeight: 700,
            fontSize: "0.88rem",
            cursor: (sending || !text.trim()) ? "not-allowed" : "pointer",
          }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const composerIconButtonStyle = {
  padding: "0.65rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: "1.05rem",
  color: "var(--text-secondary)",
} as const;

function ClosedWindowComposer({
  channelId,
  onSend,
  disabled,
}: {
  channelId: string;
  onSend: (templateName: string, languageCode: string, variables: Record<string, string>) => void;
  disabled: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);

  if (showPicker) {
    return (
      <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
        <TemplatePicker
          channelId={channelId}
          onSelect={(name, lang, vars) => {
            setShowPicker(false);
            onSend(name, lang, vars);
          }}
          onCancel={() => setShowPicker(false)}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        background: "var(--warning-soft)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--warning)" }}>
        The 24-hour reply window has closed. You can only send an approved template message.
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <textarea
          value=""
          disabled
          placeholder="Free-text replies are unavailable until the contact messages again"
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            padding: "0.65rem 0.75rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text-muted)",
            font: "inherit",
          }}
        />
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          disabled={disabled}
          title="Send a template message"
          style={{
            padding: "0.65rem 1.25rem",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            fontWeight: 700,
            fontSize: "0.85rem",
            cursor: disabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Send a template
        </button>
      </div>
    </div>
  );
}

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
    <p style={{ margin: "0 var(--space-3)", fontSize: "0.78rem", color: "var(--warning)", fontWeight: 600, position: "absolute", top: "-1.5rem", left: "0" }}>
      Window closes in {formatDurationShort(remainingMs)}
    </p>
  );
}
