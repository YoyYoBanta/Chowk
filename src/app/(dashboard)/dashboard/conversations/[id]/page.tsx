import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { getConversationWithContact } from "@/data/conversations";
import { listMessagesPage } from "@/data/messages";
import { ThreadView } from "../../_components/thread-view";
import { ContactPanel } from "../../_components/contact-panel";
import type { ConversationDetailDTO, MessageDTO } from "../../../_lib/types";

/**
 * Thread page (context.md §10.3 + §10.5): the message history for one
 * conversation, plus the read-only contact panel. Tenancy is enforced by
 * `getConversationWithContact` itself (organizationId-scoped lookup) —
 * a conversation id from another org resolves to null here and 404s,
 * exactly like the API route's own tenancy test.
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

  const conversationDTO: ConversationDetailDTO = {
    id: conversation.id,
    status: conversation.status,
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
    lastInboundAt: conversation.lastInboundAt ? conversation.lastInboundAt.toISOString() : null,
    channel: conversation.channel,
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      displayName: conversation.contact.displayName,
      waId: conversation.contact.waId,
      isBlocked: conversation.contact.isBlocked,
    },
  };

  const initialMessagesNewestFirst: MessageDTO[] = items.map((message) => ({
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
  }));

  return (
    <main style={{ maxWidth: "64rem", margin: "0 auto", padding: "1rem" }}>
      <p>
        <Link href="/dashboard">&larr; Back to inbox</Link>
      </p>
      <div style={{ display: "flex", gap: "1rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: "1.2em" }}>
            {conversationDTO.contact.displayName ?? conversationDTO.contact.name ?? conversationDTO.contact.waId}
          </h1>
          <ThreadView
            conversationId={conversationDTO.id}
            initialMessagesNewestFirst={initialMessagesNewestFirst}
            initialOlderCursor={nextCursor}
          />
          <div style={{ borderTop: "1px solid var(--border, #e5e5e5)", padding: "0.75rem", opacity: 0.6 }}>
            {/* Composer is M4 — no send capability yet. */}
            <em>Sending messages arrives in a later milestone.</em>
          </div>
        </div>
        <ContactPanel conversation={conversationDTO} />
      </div>
    </main>
  );
}
