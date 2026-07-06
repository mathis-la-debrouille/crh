import { searchEmails } from "@/lib/gmail-tools";
import { getValidAccessToken } from "@/lib/google";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";

export async function checkInboxForUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      whatsappNumber: true,
      googleConnected: true,
      inboxWatchEnabled: true,
      inboxWatchIntervalMins: true,
      inboxWatchLastChecked: true,
    },
  });

  if (!user?.whatsappNumber || !user.inboxWatchEnabled || !user.googleConnected) return;

  const now = new Date();
  const intervalMs = (user.inboxWatchIntervalMins ?? 15) * 60 * 1000;

  // Skip if not enough time has passed since last check
  if (user.inboxWatchLastChecked) {
    const elapsed = now.getTime() - new Date(user.inboxWatchLastChecked).getTime();
    if (elapsed < intervalMs) return;
  }

  // Mark check time immediately to avoid double-firing
  await prisma.$executeRaw`
    UPDATE User SET inboxWatchLastChecked = ${now.toISOString()} WHERE id = ${userId}
  `;

  let accessToken: string | null = null;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch {
    console.error("[inbox-watch] google token unavailable for", userId);
    return;
  }

  // Search for real emails since last check (category:primary, not from self)
  const since = user.inboxWatchLastChecked
    ? Math.floor(new Date(user.inboxWatchLastChecked).getTime() / 1000)
    : Math.floor((now.getTime() - intervalMs) / 1000);

  const emails = await searchEmails(
    accessToken,
    `category:primary after:${since} -from:me is:unread`,
    5
  );

  if (emails.length === 0) return;

  // Build notification
  let message: string;
  if (emails.length === 1) {
    const e = emails[0];
    const from = e.from.replace(/<[^>]+>/, "").trim().replace(/"/g, "");
    message = `nouveau mail de ${from} — "${e.subject}"\ntu veux que je le lise ou que je prépare une réponse ?`;
  } else {
    const lines = [`${emails.length} nouveaux mails importants :`];
    for (const e of emails) {
      const from = e.from.replace(/<[^>]+>/, "").trim().replace(/"/g, "");
      lines.push(`- ${from} — ${e.subject}`);
    }
    lines.push("tu veux que je t'en résume un ?");
    message = lines.join("\n");
  }

  await sendWhatsApp(user.whatsappNumber, message);
  console.log(`[inbox-watch] notified ${user.whatsappNumber} — ${emails.length} new email(s)`);
}

export async function checkAllInboxes(): Promise<void> {
  const users = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM User WHERE inboxWatchEnabled = 1 AND googleConnected = 1
  `;
  await Promise.all(users.map((u) => checkInboxForUser(u.id).catch(console.error)));
}
