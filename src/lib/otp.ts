import { prisma } from "@/lib/prisma";

const OTP_EXPIRY_MINS = 15;
const MAX_PENDING = 3; // max pending codes per phone per 30 min

export function normalisePhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, "").replace(/^00/, "+");
}

export async function isPhoneAllowed(phone: string): Promise<boolean> {
  const entry = await prisma.allowedNumber.findUnique({ where: { phone } });
  return !!entry;
}

// Generate a VAYT-XXXX code and store it — no delivery, user sends it to us on WhatsApp
export async function generateVerificationCode(
  phone: string
): Promise<{ ok: boolean; code?: string; error?: string }> {
  // Rate-limit: max 3 unused codes in 30 min
  const recent = await prisma.otpCode.count({
    where: { phone, used: false, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
  });
  if (recent >= MAX_PENDING) return { ok: false, error: "too_many_requests" };

  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const code = `VAYT-${digits}`;

  await prisma.otpCode.create({
    data: { phone, code, expiresAt: new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000) },
  });

  return { ok: true, code };
}

// Called by the webhook when a user sends their VAYT-XXXX code via WhatsApp
export async function consumeVerificationCode(
  phone: string,
  code: string
): Promise<{ ok: boolean; sessionToken?: string }> {
  console.log(`[signup] consumeVerificationCode: phone=${phone} code=${code}`);

  const otp = await prisma.otpCode.findFirst({
    where: { phone, code: code.toUpperCase(), used: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) {
    console.warn(`[signup] consumeVerificationCode: no matching code — expired or wrong phone=${phone} code=${code}`);
    return { ok: false };
  }

  const { randomUUID } = await import("crypto");
  const sessionToken = randomUUID();

  await prisma.otpCode.update({
    where: { id: otp.id },
    data: { used: true, sessionToken },
  });

  console.log(`[signup] consumeVerificationCode: ok phone=${phone} sessionToken=${sessionToken.slice(0, 8)}…`);
  return { ok: true, sessionToken };
}

// Polled by frontend — returns sessionToken once verification is complete
export async function checkVerificationStatus(
  phone: string
): Promise<{ verified: boolean; sessionToken?: string }> {
  const otp = await prisma.otpCode.findFirst({
    where: {
      phone,
      used: true,
      sessionToken: { not: null },
      expiresAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, // within last 15 min
    },
    orderBy: { createdAt: "desc" },
  });
  if (!otp?.sessionToken) return { verified: false };
  return { verified: true, sessionToken: otp.sessionToken };
}
