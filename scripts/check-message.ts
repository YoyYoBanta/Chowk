import { prisma } from "../src/lib/prisma";

async function main() {
  const msg = await prisma.message.findFirst({
    orderBy: { createdAt: "desc" },
    include: { conversation: true },
  });
  console.log(JSON.stringify(msg, null, 2));
}

main().finally(() => prisma.$disconnect());
