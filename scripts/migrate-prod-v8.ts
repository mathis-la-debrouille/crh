/**
 * Production migration v8 — WhatsAppMessage.channel ("whatsapp" | "web"), so
 * the WhatsApp thread and the new web chat can share one merged conversation.
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v8.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

async function run() {
  try {
    await client.execute(`ALTER TABLE WhatsAppMessage ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'`);
    console.log("✓ ALTER TABLE WhatsAppMessage ADD COLUMN channel…");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate column")) console.log("  skip (exists): channel");
    else throw e;
  }

  console.log("Migration v8 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
