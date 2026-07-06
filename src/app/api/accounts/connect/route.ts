import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { randomUUID, createHmac } from "crypto";

const GOOGLE_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

function signState(state: string, userId: string): string {
  return createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`${state}:${userId}`)
    .digest("hex");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.redirect(new URL("/signup", req.url));

  const state = randomUUID();
  const hmac = signState(state, session.userId);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXTAUTH_URL}/api/accounts/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "select_account consent",
    scope: GOOGLE_SCOPES,
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  const res = NextResponse.redirect(url);

  // Store state + hmac in cookies (10-min expiry)
  res.cookies.set("vayt-account-state", state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", maxAge: 600, path: "/",
  });
  res.cookies.set("vayt-account-hmac", hmac, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", maxAge: 600, path: "/",
  });

  return res;
}
