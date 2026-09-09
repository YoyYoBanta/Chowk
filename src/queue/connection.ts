import IORedis from "ioredis";
import { env } from "@/config/env";

/**
 * Single shared ioredis connection for BullMQ (queues.ts) and the worker's
 * Workers/consumers (src/worker/). Cached on globalThis for the same
 * hot-reload reason as src/lib/prisma.ts's PrismaClient singleton.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own documented requirement for
 * any connection it's handed — without it, ioredis can give up on a
 * command mid-retry in a way that BullMQ's blocking calls don't expect.
 *
 * `lazyConnect: true` means the constructor below performs zero network
 * I/O — the actual TCP connection only opens on first command. This
 * matters because this module is imported (transitively, via
 * src/providers/factory.ts -> src/providers/baileys/adapter.ts ->
 * src/queue/queues.ts) by the fast Vitest suite, which by design runs with
 * no Redis reachable (vitest.config.ts). A permanent no-op `error`
 * listener is attached for the same reason: if something ever does
 * attempt a command with no Redis listening, ioredis must not crash the
 * process with an unhandled 'error' event.
 */
/**
 * The one prefix every Redis key this app writes is namespaced under.
 *
 * Exported from here, next to the connection itself, so producers
 * (src/queue/queues.ts), consumers (src/worker/index.ts) and the realtime
 * pub/sub channels (src/services/realtime/publish.ts) all read the same
 * value from the same place. A producer and a consumer that disagree about
 * the prefix do not error - they simply operate on different keyspaces and
 * silently never see each other's jobs, which is the failure this constant
 * exists to make impossible. See prefix-isolation.integration.test.ts, which
 * proves both halves of that: mismatched prefixes are invisible to each
 * other, matching ones are not.
 */
export const REDIS_KEY_PREFIX: string = env.REDIS_KEY_PREFIX;

const globalForRedis = globalThis as unknown as {
  redisConnection?: IORedis;
};

function createConnection(): IORedis {
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  connection.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
  return connection;
}

export const redisConnection: IORedis = globalForRedis.redisConnection ?? createConnection();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisConnection = redisConnection;
}
