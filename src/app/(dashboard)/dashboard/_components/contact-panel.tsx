import type { ConversationDetailDTO } from "../../_lib/types";

/**
 * Contact panel, read-only (context.md §10.5, M3 scope only): name, phone
 * (`waId`). Tags/custom fields/notes/assignment don't exist as models
 * until M8 — rather than stub fake data, those sections are simply
 * omitted here with a one-line "none yet" note.
 */
export function ContactPanel({ conversation }: { conversation: ConversationDetailDTO }) {
  const { contact } = conversation;

  return (
    <aside style={{ padding: "1rem", borderLeft: "1px solid var(--border, #e5e5e5)", minWidth: "14rem" }}>
      <h2 style={{ fontSize: "1.1em" }}>
        {contact.displayName ?? contact.name ?? contact.waId}
      </h2>
      <dl>
        <dt style={{ fontSize: "0.75em", opacity: 0.6 }}>Phone</dt>
        <dd style={{ margin: 0 }}>{contact.waId}</dd>
      </dl>
      <p style={{ fontSize: "0.85em", opacity: 0.6, marginTop: "1.5rem" }}>
        Tags, custom fields, and notes aren&apos;t available yet — none yet.
      </p>
    </aside>
  );
}
