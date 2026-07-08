import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await req.json().catch(() => ({}));

  if (type === "google") {
    await prisma.emailAccount.updateMany({
      where: { userId: session.userId },
      data: { connected: false, accessToken: null, refreshToken: null, tokenExpiry: null },
    });
    await prisma.user.update({
      where: { id: session.userId },
      data: { googleConnected: false, googleAccessToken: null, googleRefreshToken: null, googleTokenExpiry: null },
    });
    return NextResponse.json({ ok: true });
  }

  if (type === "whatsapp") {
    await prisma.user.update({
      where: { id: session.userId },
      data: { whatsappConnected: false, whatsappNumber: null, phoneVerified: false },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "type must be google or whatsapp" }, { status: 400 });
}
