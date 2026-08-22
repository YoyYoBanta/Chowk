"use client";

import { useCallback, useState, useEffect } from "react";
import Link from "next/link";
import { useRealtimeEvents } from "../../_lib/use-realtime-events";
import { formatRelativeTime } from "@/lib/format/relative-time";
import type {
  ConversationListItemDTO,
  ConversationsListResponse,
  MessageCreatedRealtimeEvent,
} from "../../_lib/types";

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

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
      return `${base}?${params.toString()}`;
    },
    [filter, debouncedSearch],
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

  // Refetch when filter changes
  useEffect(() => {
    refetchFirstPage();
  }, [filter, refetchFirstPage]);

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0a0a0b", color: "#e2e2e2", fontFamily: "'Inter', sans-serif" }}>
      
      {/* Search Bar */}
      <div style={{ padding: "1rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <input
          type="text"
          placeholder="Search conversations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "0.8rem 1rem",
            borderRadius: "20px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(0,0,0,0.2)",
            color: "#fff",
            fontSize: "0.9em",
            outline: "none",
            transition: "border-color 0.2s"
          }}
          onFocus={(e) => e.target.style.borderColor = "rgba(99, 102, 241, 0.5)"}
          onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
        />
      </div>

      {/* Filter Bar */}
      <div style={{ 
        padding: "1rem", 
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex", 
        gap: "0.5rem",
        overflowX: "auto"
      }}>
        {(["ALL", "UNASSIGNED", "MINE", "CLOSED"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: "20px",
              border: "none",
              fontSize: "0.8em",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
              background: filter === f ? "linear-gradient(135deg, #6366f1, #a855f7)" : "rgba(255,255,255,0.05)",
              color: filter === f ? "#fff" : "rgba(255,255,255,0.6)",
              boxShadow: filter === f ? "0 2px 10px rgba(99, 102, 241, 0.3)" : "none"
            }}
          >
            {f === "ALL" ? "All Open" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {conversations.length === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", opacity: 0.5, fontSize: "0.9em" }}>
            No {filter.toLowerCase()} conversations.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {conversations.map((conversation) => (
              <li key={conversation.id} style={{ 
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                transition: "background 0.2s"
              }}>
                <Link
                  href={`/dashboard/conversations/${conversation.id}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    padding: "1rem",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "1rem" }}>
                    <div style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      background: "rgba(99, 102, 241, 0.1)",
                      color: "#818cf8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      flexShrink: 0
                    }}>
                      {(conversation.contact.displayName ?? conversation.contact.name ?? "U").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: conversation.unreadCount > 0 ? 600 : 500, color: "#fff" }}>
                        {conversation.contact.displayName ?? conversation.contact.name ?? conversation.contact.waId}
                        {conversation.isClosingSoon && (
                          <span style={{ marginLeft: "0.4rem", fontSize: "0.8em" }}>⏰</span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.85em", opacity: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: "4px" }}>
                        {conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                    <div style={{ fontSize: "0.75em", opacity: 0.5 }}>
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </div>
                    {conversation.unreadCount > 0 && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "12px",
                          background: "linear-gradient(135deg, #ef4444, #f97316)",
                          color: "#fff",
                          fontSize: "0.7em",
                          fontWeight: 700,
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
        )}
        {nextCursor && (
          <button 
            type="button" 
            onClick={loadMore} 
            disabled={loadingMore}
            style={{
              width: "100%",
              padding: "1rem",
              background: "transparent",
              border: "none",
              color: "#818cf8",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
