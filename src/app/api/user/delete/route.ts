import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = session.userId;

  // Delete in FK-safe order (no CASCADE defined in schema)
  await prisma.whatsAppMessage.deleteMany({ where: { userId: id } });
  await prisma.agentAction.deleteMany({ where: { userId: id } });
  await prisma.reminder.deleteMany({ where: { userId: id } });
  await prisma.contact.deleteMany({ where: { userId: id } });
  await prisma.emailAccount.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
