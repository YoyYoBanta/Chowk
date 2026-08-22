import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CustomFieldDefinition, FieldType } from "@prisma/client";

export async function createCustomFieldDefinition(
  organizationId: string,
  key: string,
  label: string,
  type: FieldType,
  options?: Prisma.InputJsonValue
): Promise<CustomFieldDefinition> {
  return prisma.customFieldDefinition.create({
    // A nullable Json field needs Prisma's own JsonNull sentinel for an
    // explicit null value — a plain `null` is ambiguous between "no value"
    // (DbNull) and "JSON null" in Prisma's Json field API.
    data: { organizationId, key, label, type, options: options ?? Prisma.JsonNull },
  });
}

export async function getCustomFieldDefinitionById(organizationId: string, id: string): Promise<CustomFieldDefinition | null> {
  return prisma.customFieldDefinition.findFirst({ where: { id, organizationId } });
}

export async function listCustomFieldDefinitions(organizationId: string): Promise<CustomFieldDefinition[]> {
  return prisma.customFieldDefinition.findMany({ where: { organizationId }, orderBy: { label: "asc" } });
}
