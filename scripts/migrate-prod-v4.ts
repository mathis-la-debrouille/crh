/**
 * Production migration v4 — onboarding state machine + writing-style fields
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v4.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

async function run() {
  const DDL: string[] = [
    `ALTER TABLE User ADD COLUMN onboardingStep TEXT NOT NULL DEFAULT 'new'`,
    `ALTER TABLE User ADD COLUMN writingStyle TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE User ADD COLUMN styleAnalyzedAt DATETIME`,
  ];

  for (const sql of DDL) {
    try {
      await client.execute(sql);
      console.log(`✓ ${sql.slice(0, 70)}…`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate column")) {
        console.log(`  skip (exists): ${sql.slice(24, 50)}`);
      } else {
        throw e;
      }
    }
  }

  // Backfill: existing users who already sent >2 inbound messages are past onboarding
  const result = await client.execute(`
    UPDATE User SET onboardingStep = 'done'
    WHERE id IN (
      SELECT userId FROM WhatsAppMessage
      WHERE direction = 'inbound'
      GROUP BY userId HAVING COUNT(*) > 2
    )
  `);
  console.log(`✓ backfill: ${result.rowsAffected} users set to onboardingStep='done'`);
  console.log("Migration v4 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
