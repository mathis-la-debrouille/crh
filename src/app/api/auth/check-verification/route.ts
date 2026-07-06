import { NextRequest, NextResponse } from "next/server";
import { normalisePhone, checkVerificationStatus } from "@/lib/otp";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ verified: false });

  const normalised = normalisePhone(phone);
  const status = await checkVerificationStatus(normalised);

  if (!status.verified) return NextResponse.json({ verified: false });

  // Set the signup cookie and return success
  const response = NextResponse.json({ verified: true });
  response.cookies.set("vayt-signup-token", status.sessionToken!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60,
    path: "/",
  });

  return response;
}
