import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = session.userId;
  const [user, messages, contacts, actions, reminders] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        email: true, name: true, timezone: true, tone: true, register: true,
        language: true, dailyBriefEnabled: true, dailyBriefTime: true,
        whatsappNumber: true, createdAt: true,
        emailAccounts: { select: { email: true, label: true, isPrimary: true, connected: true } },
      },
    }),
    prisma.whatsAppMessage.findMany({
      where: { userId: id },
      orderBy: { timestamp: "desc" },
      take: 500,
      select: { direction: true, body: true, timestamp: true },
    }),
    prisma.contact.findMany({ where: { userId: id }, select: { displayName: true, emails: true, relationship: true, notes: true } }),
    prisma.agentAction.findMany({ where: { userId: id }, select: { kind: true, summary: true, createdAt: true } }),
    prisma.reminder.findMany({ where: { userId: id }, select: { message: true, scheduledAt: true, sent: true } }),
  ]);

  const payload = { exportedAt: new Date(), user, messages, contacts, actions, reminders };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="vayt-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
