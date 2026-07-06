import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAndSendDailyBrief } from "@/lib/daily-brief";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { dailyBriefEnabled: true, dailyBriefTime: true, dailyBriefLastSent: true },
  });

  return NextResponse.json(user ?? {});
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { enabled, time, sendNow } = body as {
    enabled?: boolean;
    time?: string;
    sendNow?: boolean;
  };

  if (sendNow) {
    await generateAndSendDailyBrief(session.userId);
    return NextResponse.json({ success: true, sent: true });
  }

  const data: Record<string, unknown> = {};
  if (enabled !== undefined) data.dailyBriefEnabled = enabled;
  if (time !== undefined) data.dailyBriefTime = time;

  await prisma.user.update({ where: { id: session.userId }, data });
  return NextResponse.json({ success: true });
}
