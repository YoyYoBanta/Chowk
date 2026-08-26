"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { messageTypeLabel, parseLocationBody } from "@/lib/messages/render";
import type { MediaSummaryDTO, MessageDTO } from "../../_lib/types";

/**
 * One message row (context.md §10.3): outbound right-aligned, inbound
 * left. TEXT renders as plain text. M6 adds real rendering for every media
 * type context.md §10.3 names explicitly: image (inline + lightbox), video
 * (inline player), audio (player), document (filename + download),
 * location (map link/coordinates). Everything else (CONTACTS/INTERACTIVE/
 * TEMPLATE/BUTTON/REACTION/UNSUPPORTED, and a media message whose file
 * hasn't finished downloading yet — `message.media` still null) keeps
 * M3/M4's minimal, honest `[Type]` placeholder.
 *
 * A tick-style status label per outbound message
 * (PENDING/SENT/DELIVERED/READ/FAILED) — deliberately a simple text label,
 * not a custom icon set. On FAILED, always shows a clear, human-readable
 * explanation — the adapter's own errorMessage when we have one, a generic
 * fallback otherwise — never a bare error code alone (context.md §10.3).
 */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Sending...",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Not sent",
};

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
          borderRadius: "var(--radius-md)",
          borderBottomRightRadius: outbound ? "3px" : "var(--radius-md)",
          borderBottomLeftRadius: outbound ? "var(--radius-md)" : "3px",
          background: outbound ? "var(--accent-strong)" : "var(--surface-raised)",
          color: outbound ? "var(--text-on-accent)" : "var(--text-primary)",
        }}
      >
        <MessageContent message={message} />
        <div
          style={{
            fontSize: "0.7rem",
            opacity: outbound ? 0.8 : 0.55,
            marginTop: "0.2rem",
            textAlign: "right",
          }}
        >
          {formatRelativeTime(message.metaTimestamp)}
          {outbound ? ` · ${STATUS_LABELS[message.status] ?? message.status}` : ""}
        </div>
        {outbound && message.status === "FAILED" && (
          <div style={{ fontSize: "0.75rem", color: "var(--danger)", marginTop: "0.2rem" }}>
            Couldn&apos;t send this message — {message.errorMessage || "please try again."}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageContent({ message }: { message: MessageDTO }) {
  if (message.type === "TEXT") {
    return <span style={{ whiteSpace: "pre-wrap" }}>{message.body}</span>;
  }

  if (message.type === "LOCATION") {
    const coords = parseLocationBody(message.body);
    if (coords) {
      return (
        <a
          href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit" }}
        >
          📍 View location ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)})
        </a>
      );
    }
    return <Placeholder message={message} />;
  }

  if (
    (message.type === "IMAGE" || message.type === "VIDEO" || message.type === "AUDIO" || message.type === "DOCUMENT") &&
    !message.media
  ) {
    // Media message whose file hasn't finished downloading/uploading yet —
    // a live message.updated event (src/services/realtime/publish.ts)
    // re-renders this once it has. Never a broken <img>/<video> src.
    return (
      <span style={{ fontStyle: "italic", opacity: 0.85 }}>
        [{messageTypeLabel(message.type)} — {message.direction === "INBOUND" ? "downloading" : "uploading"}...]
      </span>
    );
  }

  if (message.type === "IMAGE" && message.media) {
    return <ImageContent media={message.media} caption={message.body} />;
  }

  if (message.type === "VIDEO" && message.media) {
    return (
      <>
        <video controls src={message.media.url} style={{ maxWidth: "260px", borderRadius: "0.5rem", display: "block" }} />
        {message.body && <div style={{ marginTop: "0.3rem" }}>{message.body}</div>}
      </>
    );
  }

  if (message.type === "AUDIO" && message.media) {
    return <audio controls src={message.media.url} style={{ maxWidth: "260px" }} />;
  }

  if (message.type === "DOCUMENT" && message.media) {
    return <DocumentContent media={message.media} caption={message.body} />;
  }

  return <Placeholder message={message} />;
}

function Placeholder({ message }: { message: MessageDTO }) {
  return (
    <span style={{ fontStyle: "italic", opacity: 0.85 }}>
      [{messageTypeLabel(message.type)}]{message.body ? ` ${message.body}` : ""}
    </span>
  );
}

/** Inline image + click-to-open lightbox (context.md §10.3: "image (inline
 * with lightbox)"). Minimal — a fixed-position full-screen overlay, click
 * anywhere to close — not a full carousel/zoom component. */
function ImageContent({ media, caption }: { media: MediaSummaryDTO; caption: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Plain <img>, not next/image: the source is an arbitrary-sized,
          authenticated app route (/api/media/:id) with no known
          width/height ahead of time — next/image's optimizer needs both,
          or a `fill` container this simple bubble layout doesn't have. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: 0, border: "none", background: "none", cursor: "zoom-in", display: "block" }}
        aria-label="Open photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={caption ?? "Photo"}
          loading="lazy"
          style={{ maxWidth: "260px", maxHeight: "260px", borderRadius: "0.5rem", display: "block" }}
        />
      </button>
      {caption && <div style={{ marginTop: "0.3rem" }}>{caption}</div>}
      {open && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={media.url}
            alt={caption ?? "Photo"}
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain" }}
          />
        </div>
      )}
    </>
  );
}

function DocumentContent({ media, caption }: { media: MediaSummaryDTO; caption: string | null }) {
  const sizeLabel = media.sizeBytes != null ? ` (${(media.sizeBytes / 1024).toFixed(0)} KB)` : "";
  return (
    <>
      <a
        href={media.url}
        target="_blank"
        rel="noreferrer"
        download={media.fileName ?? undefined}
        style={{ color: "inherit", textDecoration: "underline" }}
      >
        📄 {media.fileName ?? "Document"}
        {sizeLabel}
      </a>
      {caption && <div style={{ marginTop: "0.3rem" }}>{caption}</div>}
    </>
  );
}
