import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: { to: string; message: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { to, message } = body;
  if (!to || !message) {
    return NextResponse.json(
      { error: "Missing required fields: to, message" },
      { status: 400 }
    );
  }

  try {
    const twilioMsg = await sendWhatsApp(to, message);

    await prisma.whatsAppMessage.create({
      data: {
        userId: session.userId,
        direction: "outbound",
        body: message,
        from: process.env.TWILIO_WHATSAPP_NUMBER!,
        to,
        sid: twilioMsg.sid,
      },
    });

    return NextResponse.json({ success: true, sid: twilioMsg.sid });
  } catch (error) {
    console.error("Twilio send error:", error);
    return NextResponse.json(
      { error: "Failed to send WhatsApp message" },
      { status: 500 }
    );
  }
}
