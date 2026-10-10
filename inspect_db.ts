import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.document.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      extractionRuns: true
    }
  });
  console.dir(docs, { depth: null });
}

main().catch(console.error).finally(() => prisma.$disconnect());
