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
    };
  });

  return (
    <main style={{ maxWidth: "40rem", margin: "0 auto", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Inbox</h1>
        <form action={logoutAction}>
          <button type="submit">Log out</button>
        </form>
      </div>
      <ConversationList initialConversations={initialConversations} initialNextCursor={nextCursor} />
    </main>
  );
}
