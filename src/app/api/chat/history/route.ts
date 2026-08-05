import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  // One conversation, both channels merged chronologically.
  const rows = await prisma.whatsAppMessage.findMany({
    where: { userId: session.userId },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { id: true, direction: true, body: true, channel: true, timestamp: true },
  });
  rows.reverse();

  return NextResponse.json(rows);
}
