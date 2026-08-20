import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";

/**
 * DB-backed replacement for Baileys' own `useMultiFileAuthState` helper.
 * That helper's doc comment says it plainly: "I wouldn't endorse this for
 * any production level use other than perhaps a bot. Would recommend
 * writing an auth state for use with a proper SQL or No-SQL DB" — which is
 * exactly what context.md §8.1b requires too ("Session credentials persist
 * to the database or object storage, keyed by channel — not to local disk,
 * which does not survive a redeploy").
 *
 * Storage shape (prisma/schema.prisma, "M2: Baileys session credential
 * storage" section) — this is the concrete decision behind
 * `Channel.sessionRef`'s "pointer to stored Baileys session state"
 * (context.md §7.2): `Channel.sessionRef` is set to this row's id
 * (`BaileysSessionData.id`) once a session exists for that channel.
 *
 *  - `BaileysSessionData` (one row per channel): the `AuthenticationCreds`
 *    object — small, changes occasionally (on Baileys' `creds.update`).
 *  - `BaileysSignalKey` (many rows per channel): the Signal protocol key
 *    material (pre-keys, sessions, sender keys, app-state sync keys/
 *    versions, ...) — read/written far more often, and each entry
 *    independent, so it's one row per `(category, keyId)` rather than one
 *    ever-growing JSON blob that would need a read-modify-write on every
 *    single key touched.
 *
 * Buffers/Uint8Arrays inside both (raw key material) are round-tripped
 * through Baileys' own `BufferJSON.replacer`/`reviver` — the same
 * serialization helper `useMultiFileAuthState` itself uses — via a
 * stringify/parse pass, since Prisma's `Json` column needs plain
 * JSON-safe values, not live Buffer instances.
 */

function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer)) as Prisma.InputJsonValue;
}

function fromJsonSafe<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

export interface DbAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

/**
 * Loads (or initializes) the persisted auth state for a channel, and
 * returns the `{ state, saveCreds }` pair `makeWASocket({ auth })` expects
 * — `saveCreds` is meant to be called from the socket's `creds.update`
 * event handler, exactly as `useMultiFileAuthState`'s own docs show.
 */
export async function createDbAuthState(channelId: string): Promise<DbAuthState> {
  const existingRow = await prisma.baileysSessionData.findUnique({ where: { channelId } });
  const creds: AuthenticationCreds = existingRow?.creds
    ? fromJsonSafe<AuthenticationCreds>(existingRow.creds)
    : initAuthCreds();

  const saveCreds = async (): Promise<void> => {
    await prisma.baileysSessionData.upsert({
      where: { channelId },
      create: { channelId, creds: toJsonSafe(creds) },
      update: { creds: toJsonSafe(creds) },
    });
  };

  if (!existingRow) {
    // Persist the freshly-initialized creds immediately so `Channel.sessionRef`
    // has something to point at even before the first `creds.update` fires.
    await saveCreds();
  }

  const keys = {
    async get<T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const rows = await prisma.baileysSignalKey.findMany({
        where: { channelId, category: type, keyId: { in: ids } },
      });
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const row of rows) {
        result[row.keyId] = fromJsonSafe<SignalDataTypeMap[T]>(row.value);
      }
      return result;
    },
    async set(data: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>>): Promise<void> {
      const writes: Promise<unknown>[] = [];
      for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        const idMap = data[category];
        if (!idMap) continue;
        for (const keyId of Object.keys(idMap)) {
          const value = idMap[keyId];
          if (value === null || value === undefined) {
            writes.push(
              prisma.baileysSignalKey.deleteMany({ where: { channelId, category, keyId } }),
            );
          } else {
            writes.push(
              prisma.baileysSignalKey.upsert({
                where: { channelId_category_keyId: { channelId, category, keyId } },
                create: { channelId, category, keyId, value: toJsonSafe(value) },
                update: { value: toJsonSafe(value) },
              }),
            );
          }
        }
      }
      await Promise.all(writes);
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
  };
}
