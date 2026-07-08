import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ALLOWED = ["assistantPaused", "tone", "register", "language", "signature", "guardrails", "timezone"] as const;
type SettingKey = typeof ALLOWED[number];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { assistantPaused: true, tone: true, register: true, language: true, signature: true, guardrails: true, timezone: true },
  });
  return NextResponse.json(user ?? {});
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) data[key as SettingKey] = body[key];
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  await prisma.user.update({ where: { id: session.userId }, data });
  return NextResponse.json({ ok: true });
}
