/**
 * Production migration v7 — sender rules (always_show/mute per email or domain)
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v7.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

async function run() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "SenderRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "pattern" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SenderRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  console.log("✓ CREATE TABLE SenderRule (if not exists)");

  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "SenderRule_userId_pattern_key" ON "SenderRule"("userId", "pattern")`);
  console.log("✓ CREATE UNIQUE INDEX SenderRule_userId_pattern_key (if not exists)");

  console.log("Migration v7 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
