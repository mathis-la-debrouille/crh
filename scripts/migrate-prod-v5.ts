/**
 * Production migration v5 — brief memory (dedup/repeat tracking for daily briefs)
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v5.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

async function run() {
  const DDL: string[] = [
    `ALTER TABLE User ADD COLUMN briefMemory TEXT NOT NULL DEFAULT '[]'`,
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

  console.log("Migration v5 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
