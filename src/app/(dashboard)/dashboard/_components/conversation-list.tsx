"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRealtimeEvents } from "../../_lib/use-realtime-events";
import { formatRelativeTime } from "@/lib/format/relative-time";
import type {
  ConversationListItemDTO,
  ConversationsListResponse,
  MessageCreatedRealtimeEvent,
} from "../../_lib/types";

/**
 * Conversation list (context.md §10.2): contact name/number, last message
 * preview, relative timestamp, unread badge, channel indicator, and (M5) a
 * subtle closing-soon indicator. Assignment/avatar is explicitly out of
 * scope (M8); filters (All/Unassigned/Mine/Done/channel/tag/search) are
 * M8/M9 — this renders every conversation in the org, most-recent-first,
 * with a manual "load more" for older pages.
 *
 * M5: `conversation.isClosingSoon` is server-computed
 * (src/app/api/conversations/route.ts / src/services/window.ts) — true
 * when the conversation's 24h window closes in under 2 hours. Rendered as
 * a small clock badge next to the contact name; never recomputed here from
 * `lastInboundAt` directly.
 *
 * Realtime: subscribes to `/api/events` via `useRealtimeEvents`. A live
 * `message.created` event just re-fetches page one and replaces the list
 * wholesale — simple and correct at M3's scale (no filters/sort options
 * yet to preserve across a refresh). On a genuine reconnect (a dropped SSE
 * connection coming back), the same refetch runs, which is exactly the
 * "reconcile via the regular GET endpoint" architecture.md §11 asks for.
 */
export function ConversationList({
  initialConversations,
  initialNextCursor,
}: {
  initialConversations: ConversationListItemDTO[];
  initialNextCursor: string | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const refetchFirstPage = useCallback(() => {
    void fetch("/api/conversations", { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<ConversationsListResponse>) : null))
      .then((data) => {
        if (!data) return;
        setConversations(data.conversations);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {
        // Best-effort reconcile — a failed refetch just means the list
        // stays as-is until the next event or manual reload.
      });
  }, []);

  const handleEvent = useCallback(
    (raw: string) => {
      let parsed: MessageCreatedRealtimeEvent | null = null;
      try {
        parsed = JSON.parse(raw) as MessageCreatedRealtimeEvent;
      } catch {
        return;
      }
      if (parsed?.type === "message.created") {
        refetchFirstPage();
      }
    },
    [refetchFirstPage],
  );

  useRealtimeEvents(handleEvent, refetchFirstPage);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/conversations?cursor=${encodeURIComponent(nextCursor)}`, {
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = (await res.json()) as ConversationsListResponse;
        setConversations((prev) => [...prev, ...data.conversations]);
        setNextCursor(data.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  if (conversations.length === 0) {
    return <p>No conversations yet.</p>;
  }

  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {conversations.map((conversation) => (
          <li key={conversation.id} style={{ borderBottom: "1px solid var(--border, #e5e5e5)" }}>
            <Link
              href={`/dashboard/conversations/${conversation.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "0.75rem 0",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: conversation.unreadCount > 0 ? 700 : 400 }}>
                  {conversation.contact.displayName ?? conversation.contact.name ?? conversation.contact.waId}
                  {conversation.isClosingSoon && (
                    <span
                      role="img"
                      aria-label="Reply window closing soon"
                      title="Reply window closing soon"
                      style={{ marginLeft: "0.4rem", fontSize: "0.8em" }}
                    >
                      ⏰
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.85em", opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
                  {conversation.lastMessagePreview ?? "No messages yet"}
                </div>
                <div style={{ fontSize: "0.75em", opacity: 0.6 }}>{conversation.channel.displayName}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: "0.75em", opacity: 0.6 }}>
                  {formatRelativeTime(conversation.lastMessageAt)}
                </div>
                {conversation.unreadCount > 0 && (
                  <span
                    aria-label={`${conversation.unreadCount} unread`}
                    style={{
                      display: "inline-block",
                      marginTop: "0.25rem",
                      minWidth: "1.25rem",
                      padding: "0 0.35rem",
                      borderRadius: "999px",
                      background: "#2563eb",
                      color: "#fff",
                      fontSize: "0.75em",
                      textAlign: "center",
                    }}
                  >
                    {conversation.unreadCount}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button type="button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
