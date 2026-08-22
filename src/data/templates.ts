import { prisma } from "@/lib/prisma";
import type { Prisma, Template } from "@prisma/client";

export async function listTemplates(organizationId: string, channelId: string): Promise<Template[]> {
  return prisma.template.findMany({
    where: { organizationId, channelId },
    orderBy: { name: 'asc' }
  });
}

export async function getTemplateByName(
  organizationId: string,
  channelId: string,
  name: string,
  language: string
): Promise<Template | null> {
  const template = await prisma.template.findUnique({
    where: {
      channelId_name_language: {
        channelId,
        name,
        language
      }
    }
  });

  // Verify tenancy
  if (template && template.organizationId !== organizationId) {
    return null;
  }

  return template;
}

export async function createTemplate(
  organizationId: string,
  channelId: string,
  data: {
    name: string;
    language: string;
    category: string;
    status: string;
    components: Prisma.InputJsonValue;
    metaTemplateId?: string;
  }
): Promise<Template> {
  return prisma.template.create({
    data: {
      organizationId,
      channelId,
      name: data.name,
      language: data.language,
      category: data.category,
      status: data.status,
      components: data.components,
      metaTemplateId: data.metaTemplateId,
    }
  });
}

/**
 * Template sync's upsert step (architecture.md §9: "Sched->>DB: upsert
 * Template rows (status, category, components, rejectionReason)" — Meta,
 * or its Phase A simulation, is the source of truth; our local row is
 * always overwritten to match what the provider just reported, never the
 * other way around, per context.md §4.2 ("we must treat Meta as the
 * source of truth and sync template state, not assume our local copy is
 * current").
 */
export async function upsertTemplateFromSync(
  organizationId: string,
  channelId: string,
  data: {
    name: string;
    language: string;
    category: string;
    status: string;
    components: Prisma.InputJsonValue;
    rejectionReason?: string | null;
  },
): Promise<Template> {
  return prisma.template.upsert({
    where: {
      channelId_name_language: { channelId, name: data.name, language: data.language },
    },
    create: {
      organizationId,
      channelId,
      name: data.name,
      language: data.language,
      category: data.category,
      status: data.status,
      components: data.components,
      rejectionReason: data.rejectionReason ?? null,
      lastSyncedAt: new Date(),
    },
    update: {
      category: data.category,
      status: data.status,
      components: data.components,
      rejectionReason: data.rejectionReason ?? null,
      lastSyncedAt: new Date(),
    },
  });
}

export async function updateTemplateStatus(
  organizationId: string,
  channelId: string,
  name: string,
  language: string,
  status: string,
  rejectionReason?: string
): Promise<Template> {
  // Check tenancy first
  const existing = await getTemplateByName(organizationId, channelId, name, language);
  if (!existing) {
    throw new Error("Template not found");
  }

  return prisma.template.update({
    where: {
      channelId_name_language: {
        channelId,
        name,
        language
      }
    },
    data: {
      status,
      rejectionReason,
      lastSyncedAt: new Date()
    }
  });
}
