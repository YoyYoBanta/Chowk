import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  console.log("Wiping Phase A history...");
  
  // Wipe all Phase A messaging data
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.contact.deleteMany({});
  
  // We keep Organizations and Users intact.
  // We can also wipe Channels if we want a complete fresh slate for Meta Cloud API channels.
  // Delete BaileysSessionData first due to foreign key constraint
  await prisma.baileysSessionData.deleteMany({});
  await prisma.baileysSignalKey.deleteMany({});
  await prisma.channel.deleteMany({});
  
  console.log("Phase A data wiped. Organizations and Users retained.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
