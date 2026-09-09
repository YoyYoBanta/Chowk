import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Worker, QueueEvents } from "bullmq";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { redisConnection, REDIS_KEY_PREFIX } from "@/queue/connection";
import { getIngestInboundQueue, QUEUE_NAMES, type IngestInboundJobData } from "@/queue/queues";
import { processIngestInboundJob } from "./consumers/ingest-inbound.consumer";
import { GET as eventsGET } from "@/app/api/events/route";
import { SESSION_COOKIE_NAME, sealSessionCookie } from "@/lib/auth/session";
import type { NormalizedInboundEvent } from "@/providers/types";
import type { MessageCreatedRealtimeEvent } from "@/app/(dashboard)/_lib/types";

/**
 * The milestone's own, partially-deferred "done when" proof (see
 * TODO-VERIFY.md's M3 section for the full judgment-call writeup):
 *
 *   a synthetic NormalizedInboundEvent, pushed through the REAL
 *   ingest-inbound BullMQ queue → the REAL consumer → REAL Postgres →
 *   REAL Redis pub/sub publish, is received by a REAL SSE HTTP client
 *   connected to /api/events within a couple seconds — and an SSE
 *   connection for a DIFFERENT organization never sees it at all.
 *
 * "Real HTTP client" here means an actual TCP connection and an actual
 * `fetch()` reading a real streamed response — not a mocked Response
 * object. Since `next dev`/`next start` is a heavier and more fragile
 * thing to drive from inside a Vitest process (port management, readiness
 * polling, a full Next boot), this test instead runs a minimal Node
 * `http` bridge server that, per request, builds a real `NextRequest` from
 * the incoming socket and calls the REAL exported `GET` handler from
 * src/app/api/events/route.ts directly, then streams its real
 * `ReadableStream` response body back over the real socket. Everything
 * below the routing/dev-server plumbing — auth, Redis subscribe, SSE
 * framing, the queue/consumer/publish pipeline — is the genuine,
 * unmodified application code path. See TODO-VERIFY.md for why this
 * bridge, rather than a full `next dev`/`next start` child process, was
 * judged the right tradeoff here.
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrgWithChannel(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000004",
    provider: "baileys",
    status: "DISCONNECTED",
  });
  return { org, channel };
}

async function cookieHeaderFor(organizationId: string): Promise<string> {
  const sealed = await sealSessionCookie({
    userId: `user_${randomUUID().slice(0, 8)}`,
    organizationId,
    role: "AGENT",
  });
  return `${SESSION_COOKIE_NAME}=${sealed}`;
}

function makeEvent(
  channelId: string,
  overrides: Partial<NormalizedInboundEvent> & { providerMessageId: string },
): NormalizedInboundEvent {
  return {
    channelId,
    from: "911234599999",
    contactName: "SSE Test Contact",
    timestamp: new Date(),
    type: "TEXT",
    body: "hello via the real SSE pipeline",
    media: null,
    interactive: null,
    raw: { note: "synthetic event for the real SSE pipeline test" },
    ...overrides,
  };
}

let bridgeServer: http.Server | undefined;
let bridgeBaseUrl = "";
let worker: Worker<IngestInboundJobData> | undefined;
let queueEvents: QueueEvents | undefined;

beforeAll(async () => {
  bridgeServer = http.createServer((req, res) => {
    void (async () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join("; "));
      }
      const request = new NextRequest(`${bridgeBaseUrl}${req.url ?? "/"}`, {
        method: req.method,
        headers,
      });

      const response = await eventsGET(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));

      if (!response.body) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      req.on("close", () => {
        reader.cancel().catch(() => undefined);
      });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        res.end();
      }
    })();
  });

  await new Promise<void>((resolve) => {
    bridgeServer?.listen(0, "127.0.0.1", resolve);
  });
  const address = bridgeServer?.address() as AddressInfo;
  bridgeBaseUrl = `http://127.0.0.1:${address.port}`;

  worker = new Worker<IngestInboundJobData>(
    QUEUE_NAMES.ingestInbound,
    async (job) => {
      await processIngestInboundJob(job.data);
    },
    // Same prefix as the producer (src/queue/queues.ts) — a mismatch here
    // does not error, it just means this worker never sees the job.
    { connection: redisConnection, prefix: REDIS_KEY_PREFIX },
  );
  queueEvents = new QueueEvents(QUEUE_NAMES.ingestInbound, {
    connection: redisConnection,
    prefix: REDIS_KEY_PREFIX,
  });
  await worker.waitUntilReady();
  await queueEvents.waitUntilReady();
}, 30_000);

afterAll(async () => {
  await worker?.close();
  await queueEvents?.close();
  await getIngestInboundQueue()
    .obliterate({ force: true })
    .catch(() => undefined);
  await getIngestInboundQueue().close();
  await new Promise<void>((resolve) => bridgeServer?.close(() => resolve()));

  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
  await redisConnection.quit();
}, 30_000);

/**
 * Opens a real SSE HTTP connection and continuously pumps its body in the
 * background, accumulating every `data:` line's payload into `events`
 * (live, readable at any time) and resolving `ready` the moment the
 * server's initial `: connected` comment arrives — i.e. the moment the
 * real Redis SUBSCRIBE has actually registered server-side (see
 * src/app/api/events/route.ts's doc comment on why that ordering matters:
 * Redis pub/sub has no replay, so a publish before SUBSCRIBE registers is
 * simply missed). Tests await `ready` before triggering the publish that
 * should be delivered, which is what makes this deterministic rather than
 * a timing-dependent guess.
 */
function openSseConnection(response: Response): {
  ready: Promise<void>;
  events: string[];
  waitUntil: (predicate: (events: string[]) => boolean, timeoutMs: number) => Promise<void>;
  close: () => Promise<void>;
} {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = "";
  let connected = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!connected && chunk.startsWith(":")) {
            connected = true;
            resolveReady();
          }
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
          if (dataLine) events.push(dataLine.slice("data: ".length));
        }
      }
    } catch {
      // Reader cancelled/errored on close — nothing left to do.
    }
  })();

  return {
    ready,
    events,
    waitUntil: async (predicate, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(events)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    close: async () => {
      await reader.cancel().catch(() => undefined);
      await pump;
    },
  };
}

describe("SSE pipeline end to end (real Redis pub/sub + real BullMQ + real HTTP)", () => {
  it("delivers a message.created event to the right org's SSE connection within a couple seconds", async () => {
    const { org, channel } = await makeOrgWithChannel("SSE E2E Org");
    const cookie = await cookieHeaderFor(org.id);

    const response = await fetch(`${bridgeBaseUrl}/api/events`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const connection = openSseConnection(response);
    await connection.ready; // real SUBSCRIBE has registered server-side

    const providerMessageId = `sse-e2e-${suffix}-1`;
    const event = makeEvent(channel.id, { providerMessageId, from: `9141${suffix}` });

    const job = await getIngestInboundQueue().add(QUEUE_NAMES.ingestInbound, {
      organizationId: org.id,
      provider: "baileys",
      event,
    });
    await job.waitUntilFinished(queueEvents!, 15_000);

    await connection.waitUntil(
      (events) => events.some((raw) => raw.includes(providerMessageId)),
      5_000,
    );
    await connection.close();

    const matching = connection.events
      .map((raw) => JSON.parse(raw) as MessageCreatedRealtimeEvent)
      .find((parsed) => parsed.message.providerMessageId === providerMessageId);

    expect(matching).toBeDefined();
    expect(matching?.type).toBe("message.created");
    expect(matching?.organizationId).toBe(org.id);
    expect(matching?.message.body).toBe("hello via the real SSE pipeline");
  }, 20_000);

  it("never delivers one organization's event to another organization's SSE connection", async () => {
    const a = await makeOrgWithChannel("SSE Isolation Org A");
    const b = await makeOrgWithChannel("SSE Isolation Org B");
    const cookieA = await cookieHeaderFor(a.org.id);
    const cookieB = await cookieHeaderFor(b.org.id);

    const [responseA, responseB] = await Promise.all([
      fetch(`${bridgeBaseUrl}/api/events`, { headers: { cookie: cookieA } }),
      fetch(`${bridgeBaseUrl}/api/events`, { headers: { cookie: cookieB } }),
    ]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);

    const connectionA = openSseConnection(responseA);
    const connectionB = openSseConnection(responseB);
    // Both subscriptions must be registered before we publish — otherwise
    // a slow-to-subscribe connection A would make this test flaky for a
    // reason that has nothing to do with tenancy isolation.
    await Promise.all([connectionA.ready, connectionB.ready]);

    const providerMessageId = `sse-isolation-${suffix}-1`;
    const event = makeEvent(a.channel.id, { providerMessageId, from: `9142${suffix}` });

    const job = await getIngestInboundQueue().add(QUEUE_NAMES.ingestInbound, {
      organizationId: a.org.id,
      provider: "baileys",
      event,
    });
    await job.waitUntilFinished(queueEvents!, 15_000);

    await connectionA.waitUntil(
      (events) => events.some((raw) => raw.includes(providerMessageId)),
      5_000,
    );
    // Org B gets no predicate to wait FOR (there's nothing that should
    // arrive) — just a fixed window past org A's confirmed delivery, long
    // enough that a cross-tenant leak would have shown up by now.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    await connectionA.close();
    await connectionB.close();

    const matchingA = connectionA.events
      .map((raw) => JSON.parse(raw) as MessageCreatedRealtimeEvent)
      .find((parsed) => parsed.message.providerMessageId === providerMessageId);
    expect(matchingA).toBeDefined();

    const leakedToB = connectionB.events.some((raw) => raw.includes(providerMessageId));
    expect(leakedToB).toBe(false);
  }, 20_000);
});
