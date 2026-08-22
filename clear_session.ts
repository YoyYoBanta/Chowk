import 'dotenv/config';
import { prisma } from './src/lib/prisma';

async function main() {
  console.log('Deleting Baileys session data...');
  const deletedKeys = await prisma.baileysSignalKey.deleteMany();
  console.log(`Deleted ${deletedKeys.count} signal keys.`);
  
  const deletedSessions = await prisma.baileysSessionData.deleteMany();
  console.log(`Deleted ${deletedSessions.count} session data rows.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
