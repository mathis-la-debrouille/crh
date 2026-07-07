import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, ADMIN_EMAIL } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } });
  return NextResponse.json({ connected: !!admin?.claudeApiKey });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { claudeApiKey } = await req.json().catch(() => ({}));
  if (!claudeApiKey || typeof claudeApiKey !== "string" || !claudeApiKey.startsWith("sk-ant-")) {
    return NextResponse.json({ error: "Invalid key — must start with sk-ant-" }, { status: 400 });
  }
  await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { claudeApiKey: claudeApiKey.trim() } });
  return NextResponse.json({ ok: true });
}
