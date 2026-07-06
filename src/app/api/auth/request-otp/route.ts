import { NextRequest, NextResponse } from "next/server";
import { normalisePhone, isPhoneAllowed, generateVerificationCode } from "@/lib/otp";

export async function POST(req: NextRequest) {
  const { phone } = await req.json().catch(() => ({}));
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const normalised = normalisePhone(phone);
  if (!/^\+\d{7,15}$/.test(normalised)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const allowed = await isPhoneAllowed(normalised);
  if (!allowed) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  const result = await generateVerificationCode(normalised);
  if (!result.ok) {
    if (result.error === "too_many_requests") {
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    code: result.code,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? "",
  });
}
