import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: fetch user's WhatsApp status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { whatsappNumber: true, whatsappConnected: true },
  });

  return NextResponse.json(user);
}

// POST: save WhatsApp number and mark as connected
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { whatsappNumber: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { whatsappNumber } = body;
  if (!whatsappNumber || !/^\+[1-9]\d{7,14}$/.test(whatsappNumber)) {
    return NextResponse.json(
      { error: "Invalid phone number. Use E.164 format: +33612345678" },
      { status: 400 }
    );
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { whatsappNumber, whatsappConnected: true },
    select: { whatsappNumber: true, whatsappConnected: true },
  });

  return NextResponse.json(user);
}
