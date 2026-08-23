import { findCandidateUsersByEmailForLogin } from "@/data/users";
import { verifyPassword } from "./password";
import { createSession } from "./session";

export type LoginResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Invalid email or password.";

/**
 * Verifies email + password and, on success, establishes the session.
 *
 * `findCandidateUsersByEmailForLogin` deliberately searches across all
 * organizations (see its doc comment in src/data/users.ts) because the M1
 * login form has no tenant selector. The password check below is what
 * actually resolves which single organization (if any) the credentials
 * belong to — the session is only ever created for the one candidate whose
 * password matches.
 */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const candidates = await findCandidateUsersByEmailForLogin(normalizedEmail);

  for (const candidate of candidates) {
    const passwordMatches = await verifyPassword(password, candidate.passwordHash);
    // A deactivated user (admin's Users screen, M8) fails the same generic
    // error as a wrong password — never a distinct message, so a login
    // attempt can't be used to probe whether an email is deactivated vs.
    // simply wrong.
    if (passwordMatches && !candidate.isActive) {
      continue;
    }
    if (passwordMatches) {
      await createSession({
        userId: candidate.id,
        organizationId: candidate.organizationId,
        role: candidate.role,
      });
      return { ok: true };
    }
  }

  return { ok: false, error: GENERIC_ERROR };
}
