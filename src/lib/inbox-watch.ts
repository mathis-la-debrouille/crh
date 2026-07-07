import { searchEmails } from "@/lib/gmail-tools";
import { getValidAccessToken } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { triageEmails } from "@/lib/email-triage";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";

export async function checkInboxForUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappNumber: true, inboxWatchEnabled: true, inboxWatchIntervalMins: true },
  });

  if (!user?.whatsappNumber || !user.inboxWatchEnabled) return;

  const accounts = await getConnectedAccounts(userId);
  const watchableAccounts = accounts.filter((a) => a.connected);
  if (watchableAccounts.length === 0) return;

  const multiAccount = watchableAccounts.length > 1;
  const intervalMs = (user.inboxWatchIntervalMins ?? 15) * 60 * 1000;
  const now = new Date();

  for (const acct of watchableAccounts) {
    const rows = await prisma.$queryRaw<{ inboxWatchEnabled: number; inboxWatchLastChecked: string | null }[]>`
      SELECT inboxWatchEnabled, inboxWatchLastChecked FROM EmailAccount WHERE id = ${acct.id} LIMIT 1
    `;
    const acctRow = rows[0];
    if (!acctRow?.inboxWatchEnabled) continue;

    const lastChecked = acctRow.inboxWatchLastChecked ? new Date(acctRow.inboxWatchLastChecked) : null;
    if (lastChecked && now.getTime() - lastChecked.getTime() < intervalMs) continue;

    // Claim check time immediately
    await prisma.$executeRaw`
      UPDATE EmailAccount SET inboxWatchLastChecked = ${now.toISOString()} WHERE id = ${acct.id}
    `;

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(acct.id);
    } catch {
      console.error(`[inbox-watch] token unavailable for ${acct.email}`);
      continue;
    }

    const since = lastChecked
      ? Math.floor(lastChecked.getTime() / 1000)
      : Math.floor((now.getTime() - intervalMs) / 1000);

    const emails = await searchEmails(
      accessToken,
      `after:${since} -from:me is:unread in:inbox`,
      10
    );

    if (emails.length === 0) continue;

    const triaged = await triageEmails(userId, emails);
    const urgent = triaged.filter((e) => e.priority === "high");
    if (urgent.length === 0) continue;

    const nameOf = (f: string) => f.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
    const prefix = multiAccount ? `[${acct.label}] ` : "";
    let message: string;
    if (urgent.length === 1) {
      const e = urgent[0];
      message = `${prefix}${nameOf(e.from)} — ${e.subject}`;
      if (e.category === "human") message += `\nje te prépare une réponse ?`;
    } else {
      const top = urgent.slice(0, 2).map((e) => `${prefix}${nameOf(e.from)} — ${e.subject}`);
      const rest = urgent.length - 2;
      message = top.join("\n") + (rest > 0 ? `\n+ ${rest} autre(s) mail(s) important(s)` : "") + `\ntu veux que je t'en résume un ?`;
    }

    await sendWhatsApp(user.whatsappNumber, message);
    console.log(`[inbox-watch] notified ${user.whatsappNumber} — ${acct.label}: ${emails.length} new email(s)`);
  }
}

export async function checkAllInboxes(): Promise<void> {
  const users = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT u.id FROM User u
    INNER JOIN EmailAccount ea ON ea.userId = u.id
    WHERE u.inboxWatchEnabled = 1 AND ea.inboxWatchEnabled = 1 AND ea.connected = 1
  `;
  await Promise.all(users.map((u) => checkInboxForUser(u.id).catch(console.error)));
}
