import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("DATABASE_URL and DATABASE_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

const migrations: { name: string; sql: string }[] = [
  {
    name: "create EmailAccount",
    sql: `
      CREATE TABLE IF NOT EXISTS "EmailAccount" (
        "id"                    TEXT NOT NULL PRIMARY KEY,
        "userId"                TEXT NOT NULL,
        "provider"              TEXT NOT NULL DEFAULT 'google',
        "email"                 TEXT NOT NULL,
        "label"                 TEXT NOT NULL,
        "isPrimary"             INTEGER NOT NULL DEFAULT 0,
        "connected"             INTEGER NOT NULL DEFAULT 1,
        "accessToken"           TEXT,
        "refreshToken"          TEXT,
        "tokenExpiry"           DATETIME,
        "displayName"           TEXT,
        "signature"             TEXT,
        "language"              TEXT,
        "styleNotes"            TEXT,
        "workContext"           TEXT,
        "inboxWatchEnabled"     INTEGER NOT NULL DEFAULT 0,
        "inboxWatchLastChecked" DATETIME,
        "createdAt"             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `,
  },
  {
    name: "create EmailAccount unique index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "EmailAccount_userId_email_key" ON "EmailAccount"("userId", "email")`,
  },
  {
    name: "create EmailAccount userId index",
    sql: `CREATE INDEX IF NOT EXISTS "EmailAccount_userId_idx" ON "EmailAccount"("userId")`,
  },
  {
    name: "add Contact.preferredAccountId",
    sql: `ALTER TABLE "Contact" ADD COLUMN "preferredAccountId" TEXT`,
  },
  {
    name: "add AgentAction.accountEmail",
    sql: `ALTER TABLE "AgentAction" ADD COLUMN "accountEmail" TEXT`,
  },
];

async function run() {
  console.log(`Connecting to ${url}`);
  for (const m of migrations) {
    try {
      await client.execute(m.sql);
      console.log(`  ✓ ${m.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // ALTER TABLE ADD COLUMN errors if column already exists — safe to skip
      if (msg.includes("duplicate column") || msg.includes("already exists")) {
        console.log(`  – ${m.name} (already applied)`);
      } else {
        console.error(`  ✗ ${m.name}: ${msg}`);
        process.exit(1);
      }
    }
  }
  console.log("Migration complete.");
}

run();
