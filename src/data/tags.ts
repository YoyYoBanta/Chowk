import { prisma } from "@/lib/prisma";
import type { Tag } from "@prisma/client";

export async function createTag(organizationId: string, name: string, color?: string): Promise<Tag> {
  return prisma.tag.create({
    data: { organizationId, name, color },
  });
}

export async function getTagById(organizationId: string, id: string): Promise<Tag | null> {
  return prisma.tag.findFirst({ where: { id, organizationId } });
}

export async function listTags(organizationId: string): Promise<Tag[]> {
  return prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export async function updateTag(organizationId: string, id: string, name?: string, color?: string): Promise<void> {
  await prisma.tag.updateMany({
    where: { id, organizationId },
    data: { name, color },
  });
}

export async function addTagToContact(organizationId: string, contactId: string, tagId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  const tag = await prisma.tag.findFirst({ where: { id: tagId, organizationId } });
  
  if (!contact || !tag) throw new Error("Contact or Tag not found");
  
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId } },
    create: { contactId, tagId },
    update: {},
  });
}

export async function removeTagFromContact(organizationId: string, contactId: string, tagId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) return;
  
  await prisma.contactTag.deleteMany({
    where: { contactId, tagId },
  });
}
