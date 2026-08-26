import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { getConversationWithContact } from "@/data/conversations";
import { listMessagesPage } from "@/data/messages";
import { attachMediaSummaries } from "@/data/media";
import { getWindowState } from "@/services/window";
import { ThreadView } from "../../../_components/thread-view";
import { ContactPanel } from "../../../_components/contact-panel";
import type { ConversationDetailDTO, MessageDTO } from "../../../../_lib/types";

/**
 * Thread page (context.md §10.3 + §10.5): the message history for one
 * conversation, plus the read-only contact panel. Tenancy is enforced by
 * `getConversationWithContact` itself (organizationId-scoped lookup) —
 * a conversation id from another org resolves to null here and 404s,
 * exactly like the API route's own tenancy test.
 *
 * Renders as the main pane next to the always-visible conversation list
 * (`(inbox)/layout.tsx`) — no back arrow or list of its own anymore, since
 * the list never leaves the screen in this layout.
 */
export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id: conversationId } = await params;

  const conversation = await getConversationWithContact(session.organizationId, conversationId);
  if (!conversation) {
    notFound();
  }

  const { items, nextCursor } = await listMessagesPage(session.organizationId, conversationId, {
    limit: 30,
  });

  const windowState = getWindowState(conversation.lastInboundAt);

  const conversationDTO: ConversationDetailDTO = {
    id: conversation.id,
    status: conversation.status,
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
    lastInboundAt: conversation.lastInboundAt ? conversation.lastInboundAt.toISOString() : null,
    isWindowOpen: windowState.isOpen,
    closesAt: windowState.closesAt ? windowState.closesAt.toISOString() : null,
    remainingMs: windowState.remainingMs,
    assignedUserId: conversation.assignedUserId,
    channel: conversation.channel,
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      displayName: conversation.contact.displayName,
      waId: conversation.contact.waId,
      isBlocked: conversation.contact.isBlocked,
      customFields: conversation.contact.customFields as Record<string, unknown>,
    },
  };

  const enrichedItems = await attachMediaSummaries(session.organizationId, items);

  const initialMessagesNewestFirst: MessageDTO[] = enrichedItems.map((message) => ({
    id: message.id,
    conversationId: message.conversationId,
    provider: message.provider,
    providerMessageId: message.providerMessageId,
    direction: message.direction,
    type: message.type,
    body: message.body,
    mediaId: message.mediaId,
    templateName: message.templateName,
    status: message.status,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    metaTimestamp: message.metaTimestamp.toISOString(),
    createdAt: message.createdAt.toISOString(),
    media: message.media,
  }));

  const name = conversationDTO.contact.displayName ?? conversationDTO.contact.name ?? conversationDTO.contact.waId;

  return (
    <div style={{ height: "100%", display: "flex", background: "var(--bg)" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            background: "var(--surface)",
          }}
        >
          <div
            aria-hidden
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "var(--accent-soft)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "0.85rem",
              flexShrink: 0,
            }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "0.98rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{name}</h1>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)" }}>+{conversationDTO.contact.waId}</p>
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ThreadView
            conversationId={conversationDTO.id}
            channelId={conversationDTO.channel.id}
            initialMessagesNewestFirst={initialMessagesNewestFirst}
            initialOlderCursor={nextCursor}
            initialIsWindowOpen={conversationDTO.isWindowOpen}
            initialClosesAt={conversationDTO.closesAt}
          />
          {/* The composer (M4) now lives inside ThreadView itself, below its
              scroll container — it owns the message list state that
              optimistic-send reconciliation needs to mutate directly. */}
        </div>
      </div>
      <ContactPanel conversation={conversationDTO} />
    </div>
  );
}
