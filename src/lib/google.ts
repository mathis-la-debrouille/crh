import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
}

async function getAuthenticatedClient(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.googleAccessToken) {
    throw new Error("User has no Google access token");
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken ?? undefined,
    expiry_date: user.googleTokenExpiry
      ? user.googleTokenExpiry.getTime()
      : undefined,
  });

  // Refresh if expired (or within 5 minutes of expiry)
  if (
    user.googleTokenExpiry &&
    user.googleTokenExpiry.getTime() < Date.now() + 5 * 60 * 1000
  ) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: credentials.access_token ?? user.googleAccessToken,
        googleTokenExpiry: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : undefined,
      },
    });
    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
}

export async function getGmailClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.gmail({ version: "v1", auth });
}

export async function getCalendarClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.calendar({ version: "v3", auth });
}
