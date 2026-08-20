import { prisma } from "@/lib/prisma";
import type { Contact } from "@prisma/client";

/**
 * organizationId-required-first-argument pattern (architecture.md §12), no
 * exceptions. `upsertContact` is the one function the ingest-inbound
 * consumer calls — it is genuinely an upsert (architecture.md §6: "repeat
 * delivery of the same event must be a no-op past the dedupe check, and
 * first-contact-ever must not race a duplicate insert"), keyed on the real
 * `@@unique([organizationId, waId])` constraint so Postgres itself
 * arbitrates concurrent first-contact races, not application logic.
 */

export interface UpsertContactInput {
  waId: string;
  name?: string | null;
  displayName?: string | null;
}

export async function upsertContact(
  organizationId: string,
  input: UpsertContactInput,
): Promise<Contact> {
  return prisma.contact.upsert({
    where: { organizationId_waId: { organizationId, waId: input.waId } },
    create: {
      organizationId,
      waId: input.waId,
      name: input.name ?? null,
      displayName: input.displayName ?? null,
    },
    // Only overwrite `name` (Meta/Baileys-supplied) on a real update — never
    // clobber an agent-edited `displayName` from an inbound event.
    update: {
      ...(input.name !== undefined ? { name: input.name } : {}),
    },
  });
}

export async function getContactById(
  organizationId: string,
  contactId: string,
): Promise<Contact | null> {
  return prisma.contact.findFirst({
    where: { id: contactId, organizationId },
  });
}

export async function getContactByWaId(
  organizationId: string,
  waId: string,
): Promise<Contact | null> {
  return prisma.contact.findUnique({
    where: { organizationId_waId: { organizationId, waId } },
  });
}

export async function listContactsInOrg(organizationId: string): Promise<Contact[]> {
  return prisma.contact.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}
