/**
 * Backfill: for every User with googleConnected=true, create a primary EmailAccount.
 * Safe to run multiple times — idempotent.
 *
 *   npx tsx scripts/backfill-email-accounts.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.$queryRaw<{
    id: string;
    email: string;
    googleAccessToken: string | null;
    googleRefreshToken: string | null;
    googleTokenExpiry: string | null;
    inboxWatchEnabled: number;
    inboxWatchLastChecked: string | null;
  }[]>`
    SELECT id, email, googleAccessToken, googleRefreshToken, googleTokenExpiry,
           inboxWatchEnabled, inboxWatchLastChecked
    FROM User
    WHERE googleConnected = 1
  `;

  let created = 0;
  let skipped = 0;

  for (const u of users) {
    const existing = await prisma.emailAccount.findUnique({
      where: { userId_email: { userId: u.id, email: u.email } },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.emailAccount.create({
      data: {
        userId: u.id,
        email: u.email,
        label: "principal",
        isPrimary: true,
        provider: "google",
        connected: true,
        accessToken: u.googleAccessToken,
        refreshToken: u.googleRefreshToken,
        tokenExpiry: u.googleTokenExpiry ? new Date(u.googleTokenExpiry) : null,
        inboxWatchEnabled: u.inboxWatchEnabled === 1,
        inboxWatchLastChecked: u.inboxWatchLastChecked
          ? new Date(u.inboxWatchLastChecked)
          : null,
      },
    });

    created++;
    console.log(`  created EmailAccount for ${u.email}`);
  }

  console.log(`\ndone — created: ${created}, skipped (already existed): ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
