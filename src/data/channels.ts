import { prisma } from "@/lib/prisma";
import type { Channel, ChannelStatus } from "@prisma/client";

/**
 * Same organizationId-required-first-argument pattern as organizations.ts /
 * users.ts (architecture.md §12) — no exceptions here. These functions
 * serve admin-facing channel management (seed script today; a future
 * channels UI/API later), always acting on behalf of a signed-in user who
 * already has organizationId from their session.
 *
 * Note this deliberately does NOT include a "look up a channel by id alone"
 * function. The worker's ingestion path needs to resolve which
 * organization a given channelId belongs to without already knowing it —
 * but that resolution happens without touching this file at all: the
 * provider adapter already holds the full `Channel` row (organizationId
 * included) from the `connect(channel)` call, and threads organizationId
 * through the BullMQ job payload itself (see src/queue/queues.ts's
 * `IngestInboundJobData`). That keeps this data-access layer free of any
 * "search without organizationId" escape hatch.
 */

export interface CreateChannelInput {
  displayName: string;
  phoneNumber: string;
  provider?: string;
  status?: ChannelStatus;
  sessionRef?: string | null;
}

export async function createChannel(
  organizationId: string,
  input: CreateChannelInput,
): Promise<Channel> {
  return prisma.channel.create({
    data: {
      organizationId,
      displayName: input.displayName,
      phoneNumber: input.phoneNumber,
      provider: input.provider,
      status: input.status,
      sessionRef: input.sessionRef,
    },
  });
}

export async function getChannelById(
  organizationId: string,
  channelId: string,
): Promise<Channel | null> {
  return prisma.channel.findFirst({
    where: { id: channelId, organizationId },
  });
}

export async function listChannelsInOrg(organizationId: string): Promise<Channel[]> {
  return prisma.channel.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateChannelStatus(
  organizationId: string,
  channelId: string,
  status: ChannelStatus,
): Promise<void> {
  await prisma.channel.updateMany({
    where: { id: channelId, organizationId },
    data: { status },
  });
}

export async function setChannelSessionRef(
  organizationId: string,
  channelId: string,
  sessionRef: string | null,
): Promise<void> {
  await prisma.channel.updateMany({
    where: { id: channelId, organizationId },
    data: { sessionRef },
  });
}
