/**
 * Production migration v2 — add assistant behavior fields to User
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v2.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

const DDL = [
  `ALTER TABLE User ADD COLUMN assistantPaused INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE User ADD COLUMN tone TEXT NOT NULL DEFAULT 'formal'`,
  `ALTER TABLE User ADD COLUMN register TEXT NOT NULL DEFAULT 'vous'`,
  `ALTER TABLE User ADD COLUMN language TEXT NOT NULL DEFAULT 'fr'`,
  `ALTER TABLE User ADD COLUMN signature TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE User ADD COLUMN guardrails TEXT NOT NULL DEFAULT '[]'`,
];

async function run() {
  for (const sql of DDL) {
    try {
      await client.execute(sql);
      console.log(`✓ ${sql.slice(0, 60)}…`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate column")) {
        console.log(`  skip (already exists): ${sql.slice(24, 50)}`);
      } else {
        throw e;
      }
    }
  }
  console.log("Migration v2 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
