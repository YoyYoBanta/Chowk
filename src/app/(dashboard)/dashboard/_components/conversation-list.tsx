"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRealtimeEvents } from "../../_lib/use-realtime-events";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { messageTypeIcon } from "@/lib/messages/render";
import type {
  ConversationListItemDTO,
  ConversationsListResponse,
  MessageCreatedRealtimeEvent,
} from "../../_lib/types";

interface TagOptionDTO {
  id: string;
  name: string;
}

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
  const [filter, setFilter] = useState<"ALL" | "UNASSIGNED" | "MINE" | "CLOSED">("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [channelId, setChannelId] = useState("");
  const [tagId, setTagId] = useState("");
  const [tagOptions, setTagOptions] = useState<TagOptionDTO[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    // /api/tags is agent-accessible (unlike /api/channels, which is
    // admin-only per context.md §9) — the channel filter's options are
    // derived from the already-loaded conversation list instead (see
    // channelOptions below), so no admin-gated fetch is needed for either.
    fetch("/api/tags")
      .then((res) => res.json())
      .then((data) => {
        if (data.tags) setTagOptions(data.tags);
      })
      .catch(() => {});
  }, []);

  // Derived from the initial, unfiltered server-rendered list — not the
  // live `conversations` state, which shrinks to just the selected
  // channel once a channel filter is applied (deriving from that would
  // make every other option disappear the moment one is picked). The
  // trade-off: a channel with zero currently-OPEN conversations at first
  // load won't appear as an option — acceptable for Tier 1, and no admin-
  // gated /api/channels fetch is needed for something agents should see.
  const channelOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of initialConversations) byId.set(c.channel.id, c.channel.displayName);
    return Array.from(byId, ([id, displayName]) => ({ id, displayName }));
  }, [initialConversations]);

  const buildQueryUrl = useCallback(
    (base: string, cursor?: string) => {
      const params = new URLSearchParams();
      if (cursor) params.append("cursor", cursor);
      if (filter === "UNASSIGNED") params.append("assignedUserId", "unassigned");
      if (filter === "MINE") params.append("assignedUserId", "me");
      // context.md §7.3's real ConversationStatus enum is OPEN | DONE — the
      // filter button's own label is "Closed" (matching context.md §10.2's
      // "All / Unassigned / Mine / Done" wording loosely), but the value
      // sent to the API must be the real enum member.
      if (filter === "CLOSED") params.append("status", "DONE");
      else params.append("status", "OPEN");
      if (debouncedSearch) params.append("search", debouncedSearch);
      if (channelId) params.append("channelId", channelId);
      if (tagId) params.append("tagId", tagId);
      return `${base}?${params.toString()}`;
    },
    [filter, debouncedSearch, channelId, tagId],
  );

  const refetchFirstPage = useCallback(() => {
    void fetch(buildQueryUrl("/api/conversations"), { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<ConversationsListResponse>) : null))
      .then((data) => {
        if (!data) return;
        setConversations(data.conversations);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {});
  }, [buildQueryUrl]);

  // Refetch when any filter dimension changes
  useEffect(() => {
    refetchFirstPage();
  }, [filter, channelId, tagId, refetchFirstPage]);

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
      const res = await fetch(buildQueryUrl("/api/conversations", nextCursor), {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)", color: "var(--text-primary)" }}>

      {/* Search */}
      <div style={{ padding: "var(--space-4) var(--space-4) var(--space-3)" }}>
        <div style={{ position: "relative" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: "var(--space-3)",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              fontSize: "0.9rem",
              pointerEvents: "none",
            }}
          >
            🔍
          </span>
          <input
            type="text"
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "0.6rem 0.75rem 0.6rem 2.1rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: "0.88rem",
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          padding: "0 var(--space-4) var(--space-3)",
          display: "flex",
          gap: "var(--space-2)",
          overflowX: "auto",
        }}
      >
        {(["ALL", "UNASSIGNED", "MINE", "CLOSED"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: "var(--radius-full)",
              border: filter === f ? "1px solid var(--accent-soft-border)" : "1px solid var(--border)",
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              background: filter === f ? "var(--accent-soft)" : "transparent",
              color: filter === f ? "var(--accent)" : "var(--text-secondary)",
            }}
          >
            {f === "ALL" ? "All Open" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
        {channelOptions.length > 1 && (
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            style={selectFilterStyle}
          >
            <option value="">All channels</option>
            {channelOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        )}
        {tagOptions.length > 0 && (
          <select
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            style={selectFilterStyle}
          >
            <option value="">All tags</option>
            {tagOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid var(--border)" }}>
        {conversations.length === 0 ? (
          <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center" }}>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              No {filter === "ALL" ? "open" : filter.toLowerCase()} conversations.
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {conversations.map((conversation) => {
              const name = conversation.contact.displayName ?? conversation.contact.name ?? conversation.contact.waId;
              const icon = conversation.lastMessageType ? messageTypeIcon(conversation.lastMessageType) : null;
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/dashboard/conversations/${conversation.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      padding: "var(--space-3) var(--space-4)",
                      textDecoration: "none",
                      color: "inherit",
                      borderBottom: "1px solid var(--border)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div
                      aria-hidden
                      style={{
                        width: "42px",
                        height: "42px",
                        borderRadius: "50%",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "0.95rem",
                        flexShrink: 0,
                      }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <span
                          style={{
                            fontWeight: conversation.unreadCount > 0 ? 700 : 500,
                            color: "var(--text-primary)",
                            fontSize: "0.92rem",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {name}
                        </span>
                        {conversation.isClosingSoon && (
                          <span title="Reply window closing soon" style={{ fontSize: "0.75rem", flexShrink: 0 }}>
                            ⏰
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "var(--text-muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          marginTop: "2px",
                        }}
                      >
                        {conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
                        {icon ? `${icon} ` : ""}
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </div>
                    </div>

                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        {formatRelativeTime(conversation.lastMessageAt)}
                      </span>
                      {conversation.unreadCount > 0 && (
                        <span
                          style={{
                            minWidth: "18px",
                            padding: "0 5px",
                            height: "18px",
                            borderRadius: "var(--radius-full)",
                            background: "var(--unread)",
                            color: "var(--text-on-accent)",
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              width: "100%",
              padding: "var(--space-3)",
              background: "transparent",
              border: "none",
              borderTop: "1px solid var(--border)",
              color: "var(--accent)",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: loadingMore ? "default" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

const selectFilterStyle = {
  padding: "0.35rem 0.5rem",
  borderRadius: "var(--radius-full)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: "0.78rem",
  outline: "none",
  flexShrink: 0,
} as const;
