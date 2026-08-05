/**
 * Production migration v6 — open loops (durable follow-up of ongoing subjects)
 * + register default fix (root cause of F5: "vouvoiement" injected for users
 * who never made an explicit choice).
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v6.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

async function run() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "OpenLoop" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "counterpart" TEXT,
      "direction" TEXT NOT NULL DEFAULT 'owed_by_user',
      "dueAt" DATETIME,
      "sourceKind" TEXT,
      "sourceRef" TEXT,
      "accountEmail" TEXT,
      "status" TEXT NOT NULL DEFAULT 'open',
      "nudgedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "OpenLoop_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  console.log("✓ CREATE TABLE OpenLoop (if not exists)");

  await client.execute(`CREATE INDEX IF NOT EXISTS "OpenLoop_userId_status_idx" ON "OpenLoop"("userId", "status")`);
  console.log("✓ CREATE INDEX OpenLoop_userId_status_idx (if not exists)");

  // register default fix: every existing user currently sitting on "vous" got there
  // because that WAS the old column default, not because they chose it — flip them
  // to "auto" so they pick up detectRegister() instead of being force-vouvoiement'd.
  const result = await client.execute(`UPDATE User SET register = 'auto' WHERE register = 'vous'`);
  console.log(`✓ backfill: ${result.rowsAffected} user(s) register 'vous' -> 'auto'`);

  console.log("Migration v6 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
