import type { Role } from "@prisma/client";

/**
 * A tiny in-memory stand-in for the subset of PrismaClient that
 * src/data/organizations.ts and src/data/users.ts actually call.
 *
 * Why a fake instead of a real database: this sandbox has no reachable
 * Postgres (no `psql`/`docker` available — see PROGRESS.md / TODO-VERIFY.md
 * for M1). The thing under test in the cross-tenant isolation test is the
 * *application-level* enforcement in src/data/ — whether a function scoped
 * to organizationId A can be tricked into returning organization B's row —
 * which is faithfully exercised by an in-memory store that implements the
 * same `where` semantics Postgres would, without needing Postgres itself
 * to be running. It does not exercise Postgres-level behavior (constraint
 * enforcement timing, transactions, etc.) — that needs a real database and
 * is out of scope for what this fake claims to prove.
 */
export interface FakeOrganization {
  id: string;
  name: string;
  createdAt: Date;
}

export interface FakeUser {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  isOnline: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createFakePrismaClient() {
  const organizations: FakeOrganization[] = [];
  const users: FakeUser[] = [];

  return {
    organization: {
      async create({ data }: { data: { name: string } }): Promise<FakeOrganization> {
        const org: FakeOrganization = {
          id: nextId("org"),
          name: data.name,
          createdAt: new Date(),
        };
        organizations.push(org);
        return org;
      },
      async findUnique({
        where,
      }: {
        where: { id: string };
      }): Promise<FakeOrganization | null> {
        return organizations.find((o) => o.id === where.id) ?? null;
      },
      async findMany(): Promise<FakeOrganization[]> {
        return [...organizations].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      },
    },
    user: {
      async create({
        data,
      }: {
        data: {
          organizationId: string;
          email: string;
          passwordHash: string;
          name: string;
          role?: Role;
        };
      }): Promise<FakeUser> {
        const duplicate = users.some(
          (u) => u.organizationId === data.organizationId && u.email === data.email,
        );
        if (duplicate) {
          throw new Error(
            "Unique constraint failed on the fields: (`organizationId`,`email`)",
          );
        }
        const user: FakeUser = {
          id: nextId("user"),
          organizationId: data.organizationId,
          email: data.email,
          passwordHash: data.passwordHash,
          name: data.name,
          role: data.role ?? ("AGENT" as Role),
          isOnline: false,
          lastSeenAt: null,
          createdAt: new Date(),
        };
        users.push(user);
        return user;
      },
      async findUnique({
        where,
      }: {
        where: { organizationId_email: { organizationId: string; email: string } };
      }): Promise<FakeUser | null> {
        const { organizationId, email } = where.organizationId_email;
        return (
          users.find((u) => u.organizationId === organizationId && u.email === email) ??
          null
        );
      },
      async findFirst({
        where,
      }: {
        where: { id: string; organizationId: string };
      }): Promise<FakeUser | null> {
        return (
          users.find((u) => u.id === where.id && u.organizationId === where.organizationId) ??
          null
        );
      },
      async findMany({
        where,
      }: {
        where?: { organizationId?: string; email?: string };
      } = {}): Promise<FakeUser[]> {
        return users
          .filter((u) => {
            if (where?.organizationId && u.organizationId !== where.organizationId) {
              return false;
            }
            if (where?.email && u.email !== where.email) {
              return false;
            }
            return true;
          })
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      async updateMany({
        where,
        data,
      }: {
        where: { id: string; organizationId: string };
        data: Partial<Pick<FakeUser, "isOnline" | "lastSeenAt">>;
      }): Promise<{ count: number }> {
        let count = 0;
        for (const u of users) {
          if (u.id === where.id && u.organizationId === where.organizationId) {
            Object.assign(u, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
}

export type FakePrismaClient = ReturnType<typeof createFakePrismaClient>;
