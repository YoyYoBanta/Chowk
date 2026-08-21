import { getContactByWaId } from "@/data/contacts";
import { getConversationByChannelAndContact } from "@/data/conversations";
import { isWindowOpen } from "@/services/window";
import type { SendResult } from "../types";

/**
 * context.md §8.0.4: "24-hour window | Not enforced [by Baileys] — free
 * text always works | Adapter checks lastInboundAt and returns
 * { ok: false, retryable: false, code: 'WINDOW_CLOSED' } on a free-form
 * send outside the window."
 *
 * This is defense-in-depth (context.md §8.0.4), not a duplicate of
 * src/services/messages/send-message.ts's own check — that check protects
 * every call that goes through the service layer; this one protects the
 * adapter itself against ever behaving differently from Phase B (Meta
 * Cloud API, which WILL reject an out-of-window free-form send) even if
 * some future caller reaches `sendText`/`sendMedia` directly. Both must
 * independently agree the window is closed for the send to actually fail —
 * that's the point.
 *
 * `src/services/window.ts` stays the ONE place the actual `isWindowOpen`
 * comparison is computed; this file only resolves which `lastInboundAt` to
 * feed it. `SendTextParams`/`SendMediaParams` only carry `channelId` +
 * `to` (a bare WhatsApp id, digits only) — no conversationId, no
 * organizationId — so resolving "which conversation is this" means
 * replaying the exact same lookup an inbound event would have used to
 * upsert it in the first place: contact by `(organizationId, waId)`, then
 * conversation by `(organizationId, channelId, contactId)`.
 *
 * Returns `null` when there's nothing to enforce against (no known contact,
 * no known conversation) or when the window is open — `sendText`/
 * `sendMedia` should proceed as normal in that case. Returns a
 * ready-to-return terminal `SendResult` when the window is closed.
 */
export async function checkWindowOpenForSend(
  organizationId: string,
  channelId: string,
  toWaId: string,
): Promise<SendResult | null> {
  const contact = await getContactByWaId(organizationId, toWaId);
  if (!contact) return null; // no known contact yet — nothing to enforce against

  const conversation = await getConversationByChannelAndContact(organizationId, channelId, contact.id);
  if (!conversation) return null; // no known conversation yet — nothing to enforce against

  if (isWindowOpen(conversation.lastInboundAt)) return null;

  return {
    ok: false,
    retryable: false,
    code: "WINDOW_CLOSED",
    message:
      "The 24-hour reply window has closed for this conversation. Send an approved template message instead.",
  };
}
