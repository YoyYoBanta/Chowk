import { requireSession } from "@/lib/auth/guard";
import { listConversationsPage } from "@/data/conversations";
import { messagePreviewText } from "@/lib/messages/render";
import { getWindowState } from "@/services/window";
import { logoutAction } from "./logout-action";
import { ConversationList } from "./_components/conversation-list";
import type { ConversationListItemDTO } from "../_lib/types";

// M3: the inbox itself. M1's placeholder page is now the real
// conversation list (context.md §10.2) — most-recent-first, cursor-
// paginated (src/data/conversations.ts's listConversationsPage). Filters
// (All/Unassigned/Mine/Done/channel/tag/search) are explicitly M8/M9, not
// built here; this lists every conversation in the caller's org.
export default async function DashboardHome() {
  const session = await requireSession();

  const { items, nextCursor } = await listConversationsPage(session.organizationId, { limit: 20 });
  const initialConversations: ConversationListItemDTO[] = items.map((conversation) => {
    const lastMessage = conversation.messages[0] ?? null;
    return {
      id: conversation.id,
      status: conversation.status,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      lastInboundAt: conversation.lastInboundAt ? conversation.lastInboundAt.toISOString() : null,
      isClosingSoon: getWindowState(conversation.lastInboundAt).isClosingSoon,
      contact: {
        id: conversation.contact.id,
        name: conversation.contact.name,
        displayName: conversation.contact.displayName,
        waId: conversation.contact.waId,
      },
      channel: conversation.channel,
      lastMessagePreview: lastMessage ? messagePreviewText(lastMessage) : null,
      lastMessageDirection: lastMessage?.direction ?? null,
      lastMessageType: lastMessage?.type ?? null,
    };
  });

  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        maxWidth: "34rem",
        margin: "0 auto",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "var(--space-4) var(--space-5)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Inbox</h1>
        <form action={logoutAction}>
          <button
            type="submit"
            style={{
              padding: "0.4rem 0.9rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </form>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ConversationList initialConversations={initialConversations} initialNextCursor={nextCursor} />
      </div>
    </main>
  );
}
