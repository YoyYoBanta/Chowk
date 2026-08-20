import bcrypt from "bcryptjs";

/**
 * Password hashing via bcryptjs — a pure-JS bcrypt implementation. Chosen
 * over native `bcrypt`/`argon2` bindings specifically so hashing works
 * without a node-gyp/native build toolchain (this repo is developed without
 * one — see PROGRESS.md). Same well-reviewed bcrypt algorithm, no custom
 * crypto.
 */
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
