import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "./organizations";
import { createUser } from "./users";
import { upsertContact } from "./contacts";
import { createTag, listTags, getTagById, addTagToContact, getContactTags } from "./tags";
import { createNote, getNoteById, listNotesByContact } from "./notes";
import {
  createCustomFieldDefinition,
  getCustomFieldDefinitionById,
  listCustomFieldDefinitions,
} from "./custom-fields";
import { createQuickReply, getQuickReplyById, listQuickReplies } from "./quick-replies";

/**
 * M8's own stated requirement (context.md §13: every new model needs a
 * cross-tenant isolation test — the same pattern M1 established for
 * User/Organization and M3 extended to Conversation/Message) had never been
 * applied to any of the five CRM models this milestone added: Tag,
 * ContactTag, Note, CustomFieldDefinition, QuickReply. Real Postgres
 * throughout, no mocking — same style as
 * conversations-messages-tenancy.integration.test.ts.
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrgWithContact(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  const contact = await upsertContact(org.id, { waId: `9168${suffix}${label.length}`, name: label });
  return { org, user, contact };
}

afterAll(async () => {
  await prisma.contactTag.deleteMany({ where: { tag: { organizationId: { in: createdOrgIds } } } });
  await prisma.tag.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.note.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.quickReply.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("cross-tenant isolation: Tag / ContactTag (real Postgres, no mocking)", () => {
  it("getTagById never returns Org B's tag for Org A, and listTags never includes it", async () => {
    const a = await makeOrgWithContact("Tag Org A");
    const b = await makeOrgWithContact("Tag Org B");
    const tagA = await createTag(a.org.id, "vip");
    const tagB = await createTag(b.org.id, "vip");

    await expect(getTagById(a.org.id, tagB.id)).resolves.toBeNull();
    await expect(getTagById(a.org.id, tagA.id)).resolves.toMatchObject({ id: tagA.id });

    const listA = await listTags(a.org.id);
    expect(listA.map((t) => t.id)).toContain(tagA.id);
    expect(listA.map((t) => t.id)).not.toContain(tagB.id);
  });

  it("getContactTags never returns Org B's tags for Org A's contact, even naming Org A's real contact id", async () => {
    const a = await makeOrgWithContact("ContactTag Org A");
    const b = await makeOrgWithContact("ContactTag Org B");
    const tagA = await createTag(a.org.id, "priority");
    await addTagToContact(a.org.id, a.contact.id, tagA.id);

    // Right contact, wrong org: the contact lookup inside getContactTags is
    // itself organizationId-scoped, so this must come back empty, not leak
    // Org A's tag data to a caller claiming to be Org B.
    await expect(getContactTags(b.org.id, a.contact.id)).resolves.toEqual([]);
    await expect(getContactTags(a.org.id, a.contact.id)).resolves.toMatchObject([{ id: tagA.id }]);
  });
});

describe("cross-tenant isolation: Note (real Postgres, no mocking)", () => {
  it("getNoteById never returns Org B's note for Org A", async () => {
    const a = await makeOrgWithContact("Note Org A");
    const b = await makeOrgWithContact("Note Org B");
    const noteA = await createNote(a.org.id, a.contact.id, a.user.id, "internal note about A");

    await expect(getNoteById(b.org.id, noteA.id)).resolves.toBeNull();
    await expect(getNoteById(a.org.id, noteA.id)).resolves.toMatchObject({ id: noteA.id });
  });

  it("listNotesByContact rejects a real contact id from a different organization", async () => {
    const a = await makeOrgWithContact("Note List Org A");
    const b = await makeOrgWithContact("Note List Org B");
    await createNote(a.org.id, a.contact.id, a.user.id, "note for A only");

    // b.org.id calling with a.contact.id — the contact-existence check
    // inside listNotesByContact is organizationId-scoped, so this must
    // throw rather than silently return an empty (or worse, non-empty) list.
    await expect(listNotesByContact(b.org.id, a.contact.id)).rejects.toThrow("Contact not found");
  });
});

describe("cross-tenant isolation: CustomFieldDefinition (real Postgres, no mocking)", () => {
  it("getCustomFieldDefinitionById never returns Org B's definition for Org A, and listCustomFieldDefinitions never includes it", async () => {
    const a = await makeOrgWithContact("Field Org A");
    const b = await makeOrgWithContact("Field Org B");
    const defA = await createCustomFieldDefinition(a.org.id, "company", "Company", "TEXT");
    const defB = await createCustomFieldDefinition(b.org.id, "company", "Company", "TEXT");

    await expect(getCustomFieldDefinitionById(a.org.id, defB.id)).resolves.toBeNull();
    await expect(getCustomFieldDefinitionById(a.org.id, defA.id)).resolves.toMatchObject({ id: defA.id });

    const listA = await listCustomFieldDefinitions(a.org.id);
    expect(listA.map((d) => d.id)).toContain(defA.id);
    expect(listA.map((d) => d.id)).not.toContain(defB.id);
  });
});

describe("cross-tenant isolation: QuickReply (real Postgres, no mocking)", () => {
  it("getQuickReplyById never returns Org B's quick reply for Org A, and listQuickReplies never includes it", async () => {
    const a = await makeOrgWithContact("QR Org A");
    const b = await makeOrgWithContact("QR Org B");
    const qrA = await createQuickReply(a.org.id, "hello", "Hi there!");
    const qrB = await createQuickReply(b.org.id, "hello", "Hi from B!");

    await expect(getQuickReplyById(a.org.id, qrB.id)).resolves.toBeNull();
    await expect(getQuickReplyById(a.org.id, qrA.id)).resolves.toMatchObject({ id: qrA.id });

    const listA = await listQuickReplies(a.org.id);
    expect(listA.map((q) => q.id)).toContain(qrA.id);
    expect(listA.map((q) => q.id)).not.toContain(qrB.id);
  });
});
