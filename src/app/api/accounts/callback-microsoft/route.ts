import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";

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

function err(code: string): NextResponse {
  return NextResponse.redirect(appUrl(`/dashboard?account_error=${code}`));
}

function clearCookies(res: NextResponse) {
  res.cookies.delete("vayt-account-state");
  res.cookies.delete("vayt-account-hmac");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.redirect(appUrl("/signup"));

  const { searchParams } = req.nextUrl;

  const msError = searchParams.get("error");
  if (msError) {
    console.warn(`[accounts/callback-microsoft] Microsoft error: ${msError}`);
    return err(`microsoft_${msError}`);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) return err("missing_params");

  const storedState = req.cookies.get("vayt-account-state")?.value;
  const storedHmac = req.cookies.get("vayt-account-hmac")?.value;
  if (!storedState || storedState !== state) return err("state_mismatch");
  if (!storedHmac || storedHmac !== signState(state, session.userId)) return err("state_mismatch");

  const tenant = process.env.AZURE_AD_TENANT_ID || "common";
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.AZURE_AD_CLIENT_ID!,
      client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
      redirect_uri: appUrl("/api/accounts/callback-microsoft"),
      grant_type: "authorization_code",
      scope: MS_SCOPES,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error(`[accounts/callback-microsoft] token exchange failed: ${tokenRes.status} ${body}`);
    return err("token_exchange");
  }
  const tokens = await tokenRes.json();

  const infoRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) return err("userinfo");
  const info = await infoRes.json();
  const email: string | undefined = info.mail ?? info.userPrincipalName;
  if (!email) return err("no_email");

  const conflicting = await prisma.emailAccount.findFirst({
    where: { email, userId: { not: session.userId } },
  });
  if (conflicting) {
    const res = err("owned_elsewhere");
    clearCookies(res);
    return res;
  }

  const existing = await prisma.emailAccount.findUnique({
    where: { userId_email: { userId: session.userId, email } },
  });

  const tokenExpiry = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  if (existing) {
    await prisma.emailAccount.update({
      where: { id: existing.id },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing.refreshToken,
        tokenExpiry,
        connected: true,
        provider: "microsoft",
      },
    });
  } else {
    const baseLabel = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
    const existingLabels = (
      await prisma.emailAccount.findMany({ where: { userId: session.userId }, select: { label: true } })
    ).map((a) => a.label);

    let label = baseLabel;
    let suffix = 2;
    while (existingLabels.includes(label)) label = `${baseLabel}-${suffix++}`;

    const isFirst = existingLabels.length === 0;
    await prisma.emailAccount.create({
      data: {
        userId: session.userId,
        email,
        label,
        isPrimary: isFirst,
        provider: "microsoft",
        connected: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiry,
      },
    });
  }

  const res = NextResponse.redirect(appUrl(`/dashboard?account_connected=${encodeURIComponent(email)}`));
  clearCookies(res);
  return res;
}
