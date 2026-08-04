import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { randomUUID, createHmac } from "crypto";

const MS_SCOPES = "openid email profile offline_access User.Read Mail.Read Mail.ReadWrite Calendars.ReadWrite";

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
  const tenant = process.env.AZURE_AD_TENANT_ID || "common";

  const params = new URLSearchParams({
    client_id: process.env.AZURE_AD_CLIENT_ID!,
    redirect_uri: appUrl("/api/accounts/callback-microsoft"),
    response_type: "code",
    response_mode: "query",
    prompt: "select_account",
    scope: MS_SCOPES,
    state,
  });

  const res = NextResponse.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`);
  res.cookies.set("vayt-account-state", state, {
    httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 600, path: "/",
  });
  res.cookies.set("vayt-account-hmac", hmac, {
    httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 600, path: "/",
  });
  return res;
}
