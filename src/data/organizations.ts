import { prisma } from "@/lib/prisma";
import type { Organization } from "@prisma/client";

/**
 * Organization is the tenant root — every other model (User now, and
 * Channel/Contact/Conversation/Message from M2 on) belongs to exactly one
 * Organization and must be queried through a function whose first
 * parameter is that organization's id (see src/data/users.ts). Organization
 * itself has no organizationId to scope by, so it is the one model in this
 * layer that is deliberately exempt from that rule.
 *
 * Nothing here is called from a request handler acting on behalf of a
 * signed-in user — that code always already has an organizationId from the
 * session and has no reason to look across tenants. These functions exist
 * for trusted, non-request-scoped contexts only: the seed script today,
 * future admin/ops tooling later.
 */

export async function createOrganization(name: string): Promise<Organization> {
  return prisma.organization.create({ data: { name } });
}

export async function getOrganizationById(
  organizationId: string,
): Promise<Organization | null> {
  return prisma.organization.findUnique({ where: { id: organizationId } });
}

export async function listOrganizations(): Promise<Organization[]> {
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
}
