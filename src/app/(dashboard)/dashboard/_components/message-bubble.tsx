import { formatRelativeTime } from "@/lib/format/relative-time";
import { messageTypeLabel } from "@/lib/messages/render";
import type { MessageDTO } from "../../_lib/types";

/**
 * One message row (context.md §10.3): outbound right-aligned, inbound
 * left. TEXT renders as plain text; every other `MessageType` (including
 * `UNSUPPORTED`) gets a minimal, honest placeholder — "[Photo]",
 * "[Location]", etc., plus the caption/body if the adapter captured one.
 * Full rich rendering (image lightbox, video/audio players, map links,
 * "which button the customer chose") is M6/M7 — not built here.
 */
export function MessageBubble({ message }: { message: MessageDTO }) {
  const outbound = message.direction === "OUTBOUND";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: outbound ? "flex-end" : "flex-start",
        padding: "0.15rem 0",
      }}
    >
      <div
        style={{
          maxWidth: "75%",
          padding: "0.5rem 0.75rem",
          borderRadius: "0.75rem",
          background: outbound ? "#2563eb" : "var(--bubble-bg, #f0f0f0)",
          color: outbound ? "#fff" : "inherit",
        }}
      >
        {message.type === "TEXT" ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{message.body}</span>
        ) : (
          <span style={{ fontStyle: "italic", opacity: 0.85 }}>
            [{messageTypeLabel(message.type)}]{message.body ? ` ${message.body}` : ""}
          </span>
        )}
        <div style={{ fontSize: "0.7em", opacity: 0.7, marginTop: "0.2rem", textAlign: "right" }}>
          {formatRelativeTime(message.metaTimestamp)}
          {outbound ? ` · ${message.status}` : ""}
        </div>
        {outbound && message.status === "FAILED" && message.errorMessage && (
          <div style={{ fontSize: "0.75em", color: "#ffdddd", marginTop: "0.2rem" }}>
            {message.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
