import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { claudeApiKey: true, ruleContext: true, userContext: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    claudeApiKey: user.claudeApiKey ? "sk-ant-••••••••" : null,
    ruleContext: user.ruleContext,
    userContext: user.userContext,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { claudeApiKey?: string; ruleContext?: string; userContext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Record<string, string> = {};
  if (body.claudeApiKey !== undefined) data.claudeApiKey = body.claudeApiKey;
  if (body.ruleContext !== undefined) data.ruleContext = body.ruleContext;
  if (body.userContext !== undefined) data.userContext = body.userContext;

  await prisma.user.update({ where: { id: session.userId }, data });

  return NextResponse.json({ success: true });
}
