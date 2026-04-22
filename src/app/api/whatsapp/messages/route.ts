import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await prisma.whatsAppMessage.findMany({
    where: { userId: session.userId },
    orderBy: { timestamp: "asc" },
  });

  return NextResponse.json(messages);
}
