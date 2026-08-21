"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeEvents } from "../../_lib/use-realtime-events";
import { MessageBubble } from "./message-bubble";
import type { MessageDTO, MessageCreatedRealtimeEvent, MessagesPageResponse } from "../../_lib/types";

/**
 * Thread view (context.md §10.3): reverse-chronological — oldest at top,
 * newest at the bottom, matching normal chat UX — with infinite scroll
 * upward for older history.
 *
 * The API (`GET /api/conversations/:id/messages`) is newest-first
 * (context.md §9's literal contract), so:
 *  - the initial page is reversed once for display (oldest → newest,
 *    top → bottom);
 *  - "load older" fetches the next page with the current oldest message's
 *    cursor, reverses THAT page too, then prepends it — the new page is
 *    older than everything already on screen, so it goes at the front.
 *
 * There is no send capability yet (M4) — outbound-right/inbound-left only
 * means something once M4 exists, but the alignment logic itself is
 * already correct in MessageBubble.
 *
 * Realtime: a live `message.created` event for THIS conversation is
 * appended directly (deduped by id) — no round trip needed, that's the
 * point of realtime. A reconnect (architecture.md §11) instead re-fetches
 * the latest page and merges by id, since some events may have been
 * missed while disconnected.
 */
export function ThreadView({
  conversationId,
  initialMessagesNewestFirst,
  initialOlderCursor,
}: {
  conversationId: string;
  initialMessagesNewestFirst: MessageDTO[];
  initialOlderCursor: string | null;
}) {
  // Always kept oldest → newest for rendering top-to-bottom.
  const [messages, setMessages] = useState<MessageDTO[]>(
    () => [...initialMessagesNewestFirst].reverse(),
  );
  const [olderCursor, setOlderCursor] = useState(initialOlderCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScrolledToBottomOnce = useRef(false);

  const mergeById = useCallback((prev: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] => {
    const known = new Set(prev.map((m) => m.id));
    const fresh = incoming.filter((m) => !known.has(m.id));
    return fresh.length > 0 ? [...prev, ...fresh] : prev;
  }, []);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const container = scrollContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages?cursor=${encodeURIComponent(olderCursor)}`,
        { credentials: "same-origin" },
      );
      if (res.ok) {
        const data = (await res.json()) as MessagesPageResponse;
        const olderOldestFirst = [...data.messages].reverse();
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = olderOldestFirst.filter((m) => !known.has(m.id));
          return [...fresh, ...prev];
        });
        setOlderCursor(data.nextCursor);
        // Preserve scroll position: the container just grew at the top.
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop += container.scrollHeight - prevScrollHeight;
          }
        });
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, olderCursor, loadingOlder]);

  // Infinite scroll upward: an IntersectionObserver on a sentinel div
  // above the first message triggers loadOlder() as it enters view.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadOlder();
        }
      },
      { root: container, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlder]);

  // Scroll to bottom on first render only (subsequent older-page loads
  // preserve position via the scrollTop adjustment above).
  useEffect(() => {
    if (!hasScrolledToBottomOnce.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
      hasScrolledToBottomOnce.current = true;
    }
  }, []);

  const refetchLatest = useCallback(() => {
    void fetch(`/api/conversations/${conversationId}/messages`, { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<MessagesPageResponse>) : null))
      .then((data) => {
        if (!data) return;
        const newestFirst = data.messages;
        setMessages((prev) => mergeById(prev, [...newestFirst].reverse()));
      })
      .catch(() => {
        /* best-effort reconcile */
      });
  }, [conversationId, mergeById]);

  const handleEvent = useCallback(
    (raw: string) => {
      let parsed: MessageCreatedRealtimeEvent | null = null;
      try {
        parsed = JSON.parse(raw) as MessageCreatedRealtimeEvent;
      } catch {
        return;
      }
      if (parsed?.type === "message.created" && parsed.conversationId === conversationId) {
        setMessages((prev) => mergeById(prev, [parsed.message]));
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
      }
    },
    [conversationId, mergeById],
  );

  useRealtimeEvents(handleEvent, refetchLatest);

  return (
    <div
      ref={scrollContainerRef}
      style={{ height: "70vh", overflowY: "auto", display: "flex", flexDirection: "column", padding: "0.5rem" }}
    >
      <div ref={topSentinelRef} />
      {loadingOlder && <p style={{ textAlign: "center", fontSize: "0.8em", opacity: 0.6 }}>Loading older messages...</p>}
      {messages.length === 0 && <p style={{ opacity: 0.6 }}>No messages yet.</p>}
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
