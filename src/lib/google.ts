import { prisma } from "@/lib/prisma";

async function refreshToken(
  refreshTok: string,
  accountId: string
): Promise<string> {
  const refreshRes = await Promise.race([
    fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshTok,
        grant_type: "refresh_token",
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
    throw new Error(`Token refresh failed (${refreshRes.status}): ${body}`);
  }

  const tokens = await refreshRes.json();
  console.log("[google] refreshed token for account", accountId, "expiry in", tokens.expires_in, "s");

  const newExpiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await prisma.$executeRaw`
    UPDATE EmailAccount
    SET accessToken = ${tokens.access_token},
        tokenExpiry = ${newExpiry},
        updatedAt   = ${new Date().toISOString()}
    WHERE id = ${accountId}
  `;

  return tokens.access_token as string;
}

// Primary: token management per EmailAccount row
export async function getValidAccessToken(accountId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiry: string | null;
  }[]>`
    SELECT accessToken, refreshToken, tokenExpiry
    FROM EmailAccount WHERE id = ${accountId} LIMIT 1
  `;

  const acct = rows[0];
  if (!acct?.accessToken) throw new Error("No access token for account. Please reconnect.");

  const expiryMs = acct.tokenExpiry ? new Date(acct.tokenExpiry).getTime() : null;
  const isExpired = expiryMs !== null && expiryMs < Date.now() + 5 * 60 * 1000;

  if (!isExpired) return acct.accessToken;

  if (!acct.refreshToken) throw new Error("Token expired and no refresh token. Please sign in again.");

  return refreshToken(acct.refreshToken, accountId);
}

// Per-request token cache — call once per webhook, pass getToken to all tool calls
export function makeTokenProvider(): (accountId: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (accountId: string) => {
    if (!cache.has(accountId)) {
      cache.set(accountId, getValidAccessToken(accountId));
    }
    return cache.get(accountId)!;
  };
}

/** @deprecated Use getValidAccessToken(accountId) via getConnectedAccounts + makeTokenProvider */
export async function getValidAccessTokenForUser(userId: string): Promise<string> {
  const primary = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM EmailAccount
    WHERE userId = ${userId} AND isPrimary = 1 AND connected = 1
    ORDER BY createdAt ASC LIMIT 1
  `;

  if (primary[0]) return getValidAccessToken(primary[0].id);

  // Fallback to legacy User columns for accounts not yet backfilled
  console.warn("[google] getValidAccessTokenForUser: no EmailAccount, falling back to User row for", userId);
  const rows = await prisma.$queryRaw<{
    googleAccessToken: string | null;
    googleRefreshToken: string | null;
    googleTokenExpiry: string | null;
  }[]>`SELECT googleAccessToken, googleRefreshToken, googleTokenExpiry FROM User WHERE id = ${userId} LIMIT 1`;

  const user = rows[0];
  if (!user?.googleAccessToken) throw new Error("No Google access token. Please reconnect Google.");

  const expiryMs = user.googleTokenExpiry ? new Date(user.googleTokenExpiry).getTime() : null;
  if (!expiryMs || expiryMs > Date.now() + 5 * 60 * 1000) return user.googleAccessToken;

  if (!user.googleRefreshToken) throw new Error("Google token expired. Please sign in again.");

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: user.googleRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) throw new Error(`Token refresh failed: ${refreshRes.status}`);
  const tokens = await refreshRes.json();
  const newExpiry = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
  await prisma.$executeRaw`UPDATE User SET googleAccessToken=${tokens.access_token}, googleTokenExpiry=${newExpiry} WHERE id=${userId}`;
  return tokens.access_token as string;
}
