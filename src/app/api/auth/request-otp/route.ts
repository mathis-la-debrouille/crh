import { NextRequest, NextResponse } from "next/server";
import { normalisePhone, isPhoneAllowed, generateVerificationCode } from "@/lib/otp";

export async function POST(req: NextRequest) {
  const { phone } = await req.json().catch(() => ({}));
  if (!phone || typeof phone !== "string") {
    console.warn("[signup] request-otp: missing or invalid phone");
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const normalised = normalisePhone(phone);
  if (!/^\+\d{7,15}$/.test(normalised)) {
    console.warn(`[signup] request-otp: bad format phone="${phone}" normalised="${normalised}"`);
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  console.log(`[signup] request-otp: phone=${normalised}`);

  const allowed = await isPhoneAllowed(normalised);
  if (!allowed) {
    console.warn(`[signup] request-otp: phone not in whitelist phone=${normalised}`);
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  const result = await generateVerificationCode(normalised);
  if (!result.ok) {
    if (result.error === "too_many_requests") {
      console.warn(`[signup] request-otp: rate-limited phone=${normalised}`);
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    }
    console.error(`[signup] request-otp: failed to generate code phone=${normalised}`);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  console.log(`[signup] request-otp: code generated phone=${normalised} code=${result.code}`);

  return NextResponse.json({
    ok: true,
    code: result.code,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? "",
  });
}
