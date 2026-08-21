/**
 * Dev/ops utility — flips a channel to ACTIVE so the worker's boot-time
 * `connectActiveChannels()` (src/worker/index.ts) will pair it. There is no
 * admin UI for this yet (that's M9 territory); this script exists purely so
 * a human can get a real WhatsApp session connected before then, same
 * "trusted, non-request-scoped context" spirit as `prisma/seed.ts` —
 * src/data/organizations.ts's `listOrganizations()` is documented as
 * existing for exactly this ("future admin/ops tooling").
 *
 * Run with no arguments to list every organization's channels (id,
 * displayName, status) and stop there:
 *
 *   npm run activate-channel
 *
 * Run with a channel id to activate it:
 *
 *   npm run activate-channel -- <channelId>
 *
 * After activating, start the worker (`npm run worker`) and watch its
 * stdout — a channel with no previously-paired session prints a scannable
 * QR code (src/providers/baileys/adapter.ts); scan it with WhatsApp's
 * Linked Devices. A channel with an already-paired session (persisted via
 * src/providers/baileys/session-store.ts) resumes silently, no QR needed.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { listOrganizations } from "../src/data/organizations";
import { listChannelsInOrg, updateChannelStatus } from "../src/data/channels";

async function listAll(): Promise<void> {
  const orgs = await listOrganizations();
  if (orgs.length === 0) {
    console.log("No organizations found — run `npm run seed` first.");
    return;
  }
  for (const org of orgs) {
    console.log(`\n${org.name}  (org: ${org.id})`);
    const channels = await listChannelsInOrg(org.id);
    if (channels.length === 0) {
      console.log("  (no channels)");
      continue;
    }
    for (const channel of channels) {
      console.log(`  ${channel.id}  ${channel.displayName}  [${channel.status}]  ${channel.phoneNumber}`);
    }
  }
  console.log("\nActivate one with: npm run activate-channel -- <channelId>");
}

async function activate(channelId: string): Promise<void> {
  const orgs = await listOrganizations();
  for (const org of orgs) {
    const channels = await listChannelsInOrg(org.id);
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) continue;

    await updateChannelStatus(org.id, channel.id, "ACTIVE");
    console.log(`Activated "${channel.displayName}" (${channel.id}) in ${org.name}.`);
    console.log("Now run `npm run worker` and scan the QR code it prints.");
    return;
  }

  console.error(`No channel with id "${channelId}" found in any organization. Run with no arguments to list all channels.`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const [channelId] = process.argv.slice(2);
  if (!channelId) {
    await listAll();
    return;
  }
  await activate(channelId);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
