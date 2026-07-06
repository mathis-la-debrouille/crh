import { prisma } from "@/lib/prisma";

export async function getValidAccessToken(userId: string): Promise<string> {
  console.log("[google] 1 - findUnique for userId:", userId);
  const rows = await prisma.$queryRaw<{
    googleAccessToken: string | null;
    googleRefreshToken: string | null;
    googleTokenExpiry: string | null;
  }[]>`
    SELECT googleAccessToken, googleRefreshToken, googleTokenExpiry
    FROM User WHERE id = ${userId} LIMIT 1
  `;
  console.log("[google] 2 - db done");

  const user = rows[0];
  if (!user?.googleAccessToken) {
    throw new Error("No Google access token found. Please reconnect Google.");
  }

  const expiryMs = user.googleTokenExpiry ? new Date(user.googleTokenExpiry).getTime() : null;
  const isExpired = expiryMs !== null && expiryMs < Date.now() + 5 * 60 * 1000;

  if (!isExpired) {
    console.log("[google] 3 - token still valid");
    return user.googleAccessToken;
  }

  if (!user.googleRefreshToken) {
    throw new Error("Google token expired and no refresh token. Please sign in again.");
  }

  console.log("[google] 3 - token expired, refreshing via HTTP...");
  const refreshRes = await Promise.race([
    fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: user.googleRefreshToken,
        grant_type: "refresh_token",
      }),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Token refresh timed out after 10s")), 10000)
    ),
  ]);

  if (!refreshRes.ok) {
    const errBody = await refreshRes.text();
    throw new Error(`Token refresh failed (${refreshRes.status}): ${errBody}`);
  }

  const tokens = await refreshRes.json();
  console.log("[google] 4 - refreshed token ok, expiry in", tokens.expires_in, "s");

  const newExpiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await prisma.$executeRaw`
    UPDATE User
    SET googleAccessToken = ${tokens.access_token},
        googleTokenExpiry = ${newExpiry}
    WHERE id = ${userId}
  `;

  console.log("[google] 5 - DB updated");
  return tokens.access_token as string;
}
