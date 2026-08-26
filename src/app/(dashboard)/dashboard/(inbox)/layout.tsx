import { requireSession } from "@/lib/auth/guard";
import { listConversationsPage } from "@/data/conversations";
import { messagePreviewText } from "@/lib/messages/render";
import { getWindowState } from "@/services/window";
import { ConversationList } from "../_components/conversation-list";
import type { ConversationListItemDTO } from "../../_lib/types";

// The persistent left conversation-list sidebar (WhatsApp-Web reference:
// list always visible, `{children}` is either the empty state or the open
// thread next to it — never a full-page navigation away from the list).
// Scoped to this `(inbox)` route group only, not the whole `dashboard/*`
// tree, so /dashboard/admin/* renders full-width instead of squeezed next
// to a conversation list that has nothing to do with settings.
export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      lastMessageStatus: lastMessage?.status ?? null,
    };
  });

  return (
    <>
      <div
        style={{
          width: "380px",
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <ConversationList initialConversations={initialConversations} initialNextCursor={nextCursor} />
      </div>
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>{children}</div>
    </>
  );
}
