import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// We use libSQL (Turso-compatible) for SQLite in Prisma 7+
// For dev, this points at the local file via DATABASE_URL

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Convert file:./dev.db -> file:///absolute/path/dev.db for libsql
  const libsqlUrl = url.startsWith("file:")
    ? url.replace(/^file:\.\//, `file://${process.cwd()}/`)
    : url;

  const adapter = new PrismaLibSql({ url: libsqlUrl });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
