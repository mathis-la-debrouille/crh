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

function appUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.redirect(appUrl("/signup"));

  const state = randomUUID();
  const hmac = signState(state, session.userId);
  const isProduction = process.env.NODE_ENV === "production";

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: appUrl("/api/accounts/callback"),
    response_type: "code",
    access_type: "offline",
    prompt: "select_account consent",
    scope: GOOGLE_SCOPES,
    state,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set("vayt-account-state", state, {
    httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 600, path: "/",
  });
  res.cookies.set("vayt-account-hmac", hmac, {
    httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 600, path: "/",
  });
  return res;
}
