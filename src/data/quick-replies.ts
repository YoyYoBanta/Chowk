import { prisma } from "@/lib/prisma";
import type { QuickReply } from "@prisma/client";

export async function createQuickReply(
  organizationId: string,
  shortcut: string,
  body: string,
  mediaId?: string | null
): Promise<QuickReply> {
  return prisma.quickReply.create({
    data: { organizationId, shortcut, body, mediaId },
  });
}

export async function listQuickReplies(organizationId: string): Promise<QuickReply[]> {
  return prisma.quickReply.findMany({ where: { organizationId }, orderBy: { shortcut: "asc" } });
}

export async function getQuickReplyById(organizationId: string, id: string): Promise<QuickReply | null> {
  return prisma.quickReply.findFirst({ where: { id, organizationId } });
}

export async function updateQuickReply(
  organizationId: string,
  id: string,
  shortcut?: string,
  body?: string,
  mediaId?: string | null
): Promise<void> {
  await prisma.quickReply.updateMany({
    where: { id, organizationId },
    data: { shortcut, body, mediaId },
  });
}

export async function deleteQuickReply(organizationId: string, id: string): Promise<void> {
  await prisma.quickReply.deleteMany({
    where: { id, organizationId },
  });
}
