/**
 * Production migration v3 — analytics schema: WhatsAppMessage columns + JobRun + ToolCallLog
 * Run: DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx scripts/migrate-prod-v3.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL is required");

const client = createClient({ url, authToken });

const DDL = [
  // WhatsAppMessage new columns
  `ALTER TABLE WhatsAppMessage ADD COLUMN agentIterations INTEGER`,
  `ALTER TABLE WhatsAppMessage ADD COLUMN latencyMs INTEGER`,
  `ALTER TABLE WhatsAppMessage ADD COLUMN replyOverBudget INTEGER`,
  // Indexes on WhatsAppMessage
  `CREATE INDEX IF NOT EXISTS "WhatsAppMessage_userId_idx" ON "WhatsAppMessage"("userId")`,
  `CREATE INDEX IF NOT EXISTS "WhatsAppMessage_timestamp_idx" ON "WhatsAppMessage"("timestamp")`,
  // JobRun table
  `CREATE TABLE IF NOT EXISTS "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "JobRun_job_idx" ON "JobRun"("job")`,
  `CREATE INDEX IF NOT EXISTS "JobRun_ranAt_idx" ON "JobRun"("ranAt")`,
  // ToolCallLog table
  `CREATE TABLE IF NOT EXISTS "ToolCallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "success" INTEGER NOT NULL,
    "errorMsg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "ToolCallLog_userId_idx" ON "ToolCallLog"("userId")`,
  `CREATE INDEX IF NOT EXISTS "ToolCallLog_tool_idx" ON "ToolCallLog"("tool")`,
  `CREATE INDEX IF NOT EXISTS "ToolCallLog_createdAt_idx" ON "ToolCallLog"("createdAt")`,
];

async function run() {
  for (const sql of DDL) {
    try {
      await client.execute(sql);
      console.log(`✓ ${sql.slice(0, 70).replace(/\s+/g, " ")}…`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate column") || msg.includes("already exists")) {
        console.log(`  skip (exists): ${sql.slice(0, 50).replace(/\s+/g, " ")}`);
      } else {
        throw e;
      }
    }
  }
  console.log("Migration v3 complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
