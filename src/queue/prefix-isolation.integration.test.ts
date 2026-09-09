import { afterEach, describe, expect, it, vi } from "vitest";
import { Queue, Worker } from "bullmq";
import { redisConnection, REDIS_KEY_PREFIX } from "./connection";

/**
 * Proves the guarantee REDIS_KEY_PREFIX exists to provide: two BullMQ clients
 * on the same queue *name* but different prefixes operate on disjoint
 * keyspaces and never see each other's jobs.
 *
 * This matters because the failure it prevents is silent. A producer and a
 * consumer that disagree about the prefix do not throw, warn, or fail a
 * health check - the consumer simply blocks forever on a key nobody writes
 * to, and the job sits in a queue nobody reads. Debugged from the outside
 * that looks like a broken worker or a lost job, not a config mismatch.
 *
 * The same mechanism is what isolates this suite from `npm run dev` on a
 * shared or managed Redis: vitest.integration.config.ts suffixes the prefix
 * with `_test`, so a dev worker and a test worker cannot consume each other's
 * jobs. Both halves are asserted here - mismatched prefixes are invisible to
 * one another, and matching ones genuinely do connect - because a test that
 * only checked the first half would also pass if the queue were broken
 * outright and nothing was ever delivered.
 *
 * Real Redis, no mocking. Uses a private queue name (not QUEUE_NAMES.*) so it
 * can never interact with the application's own queues, following the same
 * precedent as forced-restart.integration.test.ts.
 */
const TEST_QUEUE_NAME = `prefix-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const PREFIX_A = `${REDIS_KEY_PREFIX}_isolation_a`;
const PREFIX_B = `${REDIS_KEY_PREFIX}_isolation_b`;

interface Payload {
  marker: string;
}

const queues: Array<Queue<Payload>> = [];
const workers: Array<Worker<Payload>> = [];

function makeQueue(prefix: string): Queue<Payload> {
  const q = new Queue<Payload>(TEST_QUEUE_NAME, { connection: redisConnection, prefix });
  queues.push(q);
  return q;
}

function makeWorker(prefix: string, onJob: (p: Payload) => void): Worker<Payload> {
  const w = new Worker<Payload>(
    TEST_QUEUE_NAME,
    async (job) => {
      onJob(job.data);
    },
    { connection: redisConnection, prefix },
  );
  workers.push(w);
  return w;
}

afterEach(async () => {
  // Workers first: a Worker still blocking on a queue keeps a connection busy
  // and can resurrect keys after obliterate() runs.
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  for (const q of queues) {
    await q.obliterate({ force: true }).catch(() => {
      // Best effort - an already-empty keyspace is the expected state for the
      // prefix whose worker never received anything.
    });
    await q.close();
  }
  queues.length = 0;
});

describe("REDIS_KEY_PREFIX isolation (real Redis + real BullMQ)", () => {
  it("a worker on a different prefix never receives the producer's job, while a worker on the matching prefix does", async () => {
    const receivedByB: string[] = [];
    const receivedByA: string[] = [];

    // Consumer on the WRONG prefix. Started first and given the whole test to
    // pick something up, so "it received nothing" cannot be explained by it
    // simply not being ready yet.
    const workerB = makeWorker(PREFIX_B, (p) => receivedByB.push(p.marker));
    await workerB.waitUntilReady();

    // Producer on prefix A.
    const queueA = makeQueue(PREFIX_A);
    await queueA.waitUntilReady();
    await queueA.add("job", { marker: "only-for-a" });

    // Consumer on the MATCHING prefix, started after the job was enqueued -
    // proving the job really is sitting in A's keyspace and is deliverable.
    const workerA = makeWorker(PREFIX_A, (p) => receivedByA.push(p.marker));
    await workerA.waitUntilReady();

    await vi.waitFor(() => expect(receivedByA).toEqual(["only-for-a"]), { timeout: 10_000 });

    // The negative half. By now the matching worker has already consumed the
    // job, so the mismatched worker has had at least that long to see it.
    expect(receivedByB).toEqual([]);
  });

  it("keeps the two prefixes' job counts separate", async () => {
    const queueA = makeQueue(PREFIX_A);
    const queueB = makeQueue(PREFIX_B);
    await Promise.all([queueA.waitUntilReady(), queueB.waitUntilReady()]);

    await queueA.add("job", { marker: "a1" });
    await queueA.add("job", { marker: "a2" });
    await queueB.add("job", { marker: "b1" });

    // No workers here, so nothing is consumed - the counts are purely a
    // statement about which keyspace each job landed in.
    expect(await queueA.getWaitingCount()).toBe(2);
    expect(await queueB.getWaitingCount()).toBe(1);
  });

  it("writes its keys under the configured prefix, and this suite's prefix is the _test one", async () => {
    const queueA = makeQueue(PREFIX_A);
    await queueA.waitUntilReady();
    await queueA.add("job", { marker: "keyspace-check" });

    const keys = await redisConnection.keys(`${PREFIX_A}:${TEST_QUEUE_NAME}:*`);
    expect(keys.length).toBeGreaterThan(0);

    // vitest.integration.config.ts appends "_test" to whatever prefix the
    // environment supplies, so an integration run can never share a keyspace
    // with a dev process. If this ever fails, the suite is pointed at the dev
    // keyspace and the isolation is gone.
    expect(REDIS_KEY_PREFIX.endsWith("_test")).toBe(true);
  });
});
