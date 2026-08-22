import { prisma } from "@/lib/prisma";
import type { Note } from "@prisma/client";

export async function createNote(organizationId: string, contactId: string, authorUserId: string, body: string): Promise<Note> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new Error("Contact not found");

  return prisma.note.create({
    data: { organizationId, contactId, authorUserId, body },
  });
}

export async function getNoteById(organizationId: string, id: string): Promise<Note | null> {
  return prisma.note.findFirst({ where: { id, organizationId } });
}

export async function listNotesByContact(organizationId: string, contactId: string): Promise<Note[]> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new Error("Contact not found");

  return prisma.note.findMany({
    where: { organizationId, contactId },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateNote(organizationId: string, id: string, body: string): Promise<void> {
  await prisma.note.updateMany({
    where: { id, organizationId },
    data: { body },
  });
}

export async function deleteNote(organizationId: string, id: string): Promise<void> {
  await prisma.note.deleteMany({
    where: { id, organizationId },
  });
}
