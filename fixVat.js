const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixVat() {
  await prisma.account.updateMany({
    where: { code: '4455' },
    data: { vatType: 'VAT_COLLECTED', vatRate: 20 }
  });
  await prisma.account.updateMany({
    where: { code: '34552' },
    data: { vatType: 'VAT_DEDUCTIBLE_EXPENSES', vatRate: 20 }
  });
  await prisma.account.updateMany({
    where: { code: '34551' },
    data: { vatType: 'VAT_DEDUCTIBLE_ASSETS', vatRate: 20 }
  });
  console.log("VAT Accounts Fixed!");
}

fixVat().finally(() => prisma.$disconnect());
