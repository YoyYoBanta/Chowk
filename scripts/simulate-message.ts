import { getIngestInboundQueue } from "../src/queue/queues";
import { prisma } from "../src/lib/prisma";
import { randomUUID } from "crypto";
import type { NormalizedInboundEvent } from "../src/providers/types";

async function main() {
  const channel = await prisma.channel.findFirst({
    where: { displayName: { contains: "Acme" } },
  });

  if (!channel) throw new Error("No acme channel found");

  const event: NormalizedInboundEvent = {
    channelId: channel.id,
    providerMessageId: "MOCK_" + randomUUID(),
    from: "15551234567",
    contactName: "Simulated Tester",
    timestamp: new Date(),
    type: "TEXT",
    body: "Hello from the simulated webhook! 2",
    media: null,
    interactive: null,
    raw: { mock: true },
  };

  const job = await getIngestInboundQueue().add(
    "ingest-inbound",
    {
      organizationId: channel.organizationId,
      provider: "baileys",
      event,
    },
    {
      jobId: event.providerMessageId,
    }
  );

  console.log("Mock message enqueued with Job ID:", job.id);
  await getIngestInboundQueue().close();
  await prisma.$disconnect();
}

main().catch(console.error);
