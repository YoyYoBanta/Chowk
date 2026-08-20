import { prisma } from "@/lib/prisma";
import type { Role, User } from "@prisma/client";

/**
 * Tenancy enforcement lives here (architecture.md §12): every function
 * below — except the one clearly-marked exception at the bottom — takes
 * `organizationId` as a required, non-optional first argument and scopes
 * its Prisma query by it. A call site that "forgets" the org id is a type
 * error, not a silent cross-tenant leak. Do not add a lookup (by id, by
 * email, or otherwise) that omits it.
 */

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
  role?: Role;
}

export async function createUser(
  organizationId: string,
  input: CreateUserInput,
): Promise<User> {
  return prisma.user.create({
    data: {
      organizationId,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: input.role,
    },
  });
}

export async function getUserByEmail(
  organizationId: string,
  email: string,
): Promise<User | null> {
  return prisma.user.findUnique({
    where: { organizationId_email: { organizationId, email } },
  });
}

export async function getUserById(
  organizationId: string,
  userId: string,
): Promise<User | null> {
  return prisma.user.findFirst({
    where: { id: userId, organizationId },
  });
}

export async function listUsersInOrg(organizationId: string): Promise<User[]> {
  return prisma.user.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}

export async function setUserOnlineStatus(
  organizationId: string,
  userId: string,
  isOnline: boolean,
): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, organizationId },
    data: { isOnline, lastSeenAt: new Date() },
  });
}

/**
 * DELIBERATE, SOLE EXCEPTION to the "organizationId first" rule above.
 *
 * The M1 login form collects only email + password (context.md's spec for
 * this milestone) — there is no session yet at that point, so there is no
 * organizationId to scope by, and the UI does not ask the user to pick a
 * tenant. Because email is unique per-organization, not globally
 * (`@@unique([organizationId, email])` on User), the same address could in
 * principle belong to a user in more than one organization.
 *
 * This function is how the credential-verification step (src/lib/auth/login.ts)
 * finds every candidate across all organizations so it can check the
 * submitted password against each one and adopt whichever organization the
 * password actually matches. It must only ever be called from that one
 * bootstrap path — every other caller must go through the organizationId-
 * scoped functions above.
 */
export async function findCandidateUsersByEmailForLogin(
  email: string,
): Promise<User[]> {
  return prisma.user.findMany({ where: { email } });
}
