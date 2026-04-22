import { NextRequest, NextResponse } from "next/server";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";

// Twilio sends form-encoded data
export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const body = formData.get("Body") as string;
  const from = formData.get("From") as string; // e.g. "whatsapp:+33612345678"
  const to = formData.get("To") as string;
  const sid = formData.get("MessageSid") as string;

  const fromNumber = from.replace("whatsapp:", "");
  const toNumber = to.replace("whatsapp:", "");

  // Find user by WhatsApp number
  const user = await prisma.user.findFirst({
    where: { whatsappNumber: fromNumber },
  });

  if (user) {
    // Store the inbound message
    await prisma.whatsAppMessage.create({
      data: {
        userId: user.id,
        direction: "inbound",
        body,
        from: fromNumber,
        to: toNumber,
        sid,
      },
    });

    // Auto-reply
    const replyBody = `Received: ${body}`;
    try {
      const replyMsg = await sendWhatsApp(fromNumber, replyBody);
      await prisma.whatsAppMessage.create({
        data: {
          userId: user.id,
          direction: "outbound",
          body: replyBody,
          from: toNumber,
          to: fromNumber,
          sid: replyMsg.sid,
        },
      });
    } catch (error) {
      console.error("Auto-reply error:", error);
    }
  }

  // Return empty TwiML response (Twilio expects XML)
  return new NextResponse("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
