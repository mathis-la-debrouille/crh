import { prisma } from "@/lib/prisma";

const MS_SCOPES = "openid email profile offline_access User.Read Mail.Read Mail.ReadWrite Calendars.ReadWrite";

// Mirrors google.ts's refreshToken — same shape, same EmailAccount row updated,
// same invalid_grant → connected:false guard. Microsoft may rotate the refresh
// token on each use, unlike Google, so we persist the new one when present.
export async function refreshMicrosoftToken(
  refreshTok: string,
  accountId: string
): Promise<string> {
  const tenant = process.env.AZURE_AD_TENANT_ID || "common";

  const refreshRes = await Promise.race([
    fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        refresh_token: refreshTok,
        grant_type: "refresh_token",
        scope: MS_SCOPES,
      }),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Token refresh timed out after 10s")), 10000)
    ),
  ]);

  if (!refreshRes.ok) {
    const body = await refreshRes.text();
    if (body.includes("invalid_grant")) {
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { connected: false },
      });
    }
    throw new Error(`Microsoft token refresh failed (${refreshRes.status}): ${body}`);
  }

  const tokens = await refreshRes.json();
  console.log("[microsoft] refreshed token for account", accountId, "expiry in", tokens.expires_in, "s");

  const newExpiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await prisma.$executeRaw`
    UPDATE EmailAccount
    SET accessToken = ${tokens.access_token},
        refreshToken = ${tokens.refresh_token ?? refreshTok},
        tokenExpiry = ${newExpiry},
        updatedAt = ${new Date().toISOString()}
    WHERE id = ${accountId}
  `;

  return tokens.access_token as string;
}
