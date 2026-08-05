/**
 * Removes [PROFILE] lines that were saved from request-like messages by the old
 * onboarding logic (before it distinguished requests from self-introductions).
 * Safe to run multiple times — only touches lines that match isRequestLike now.
 *
 *   npx tsx scripts/purge-junk-profiles.ts
 *   DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/purge-junk-profiles.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { isRequestLike } from "../src/lib/onboarding";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

function makeAdapter() {
  if (url.startsWith("file:")) return new PrismaBetterSqlite3({ url });
  return new PrismaLibSql({ url, authToken });
}

const prisma = new PrismaClient({ adapter: makeAdapter() });

async function main() {
  const users = await prisma.user.findMany({
    where: { userContext: { contains: "[PROFILE]" } },
    select: { id: true, email: true, userContext: true },
  });

  let totalRemoved = 0;
  for (const u of users) {
    const lines = u.userContext.split("\n");
    const kept: string[] = [];
    let removed = 0;

    for (const line of lines) {
      if (line.startsWith("[PROFILE] ")) {
        const content = line.slice("[PROFILE] ".length);
        if (isRequestLike(content)) {
          removed++;
          console.log(`  - ${u.email}: "${content.slice(0, 80)}"`);
          continue;
        }
      }
      kept.push(line);
    }

    if (removed > 0) {
      await prisma.user.update({ where: { id: u.id }, data: { userContext: kept.join("\n") } });
      console.log(`[purge-profiles] ${u.email}: removed ${removed} junk profile line(s)`);
      totalRemoved += removed;
    }
  }

  console.log(`[purge-profiles] done — ${totalRemoved} line(s) removed across ${users.length} user(s) scanned`);
}

main().catch((e) => { console.error(e); process.exit(1); });
