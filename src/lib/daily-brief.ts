import { searchEmails } from "@/lib/gmail-tools";
import { listCalendarEvents } from "@/lib/calendar-tools";
import { getValidAccessToken } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";

function todayRange(tz: string): { timeMin: string; timeMax: string } {
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  return { timeMin: `${localDate}T00:00:00`, timeMax: `${localDate}T23:59:59` };
}

function formatTime(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export async function generateBriefText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, userContext: true },
  });

  const briefContentLine = user?.userContext?.split("\n").find((l) => l.toLowerCase().includes("brief_content"));
  const briefContent = briefContentLine?.toLowerCase() ?? "";
  const showProjects = briefContent.includes("sujets") || briefContent.includes("projet");
  const showReminders = briefContent.includes("rappel");

  const tz = user?.timezone ?? "Europe/Paris";
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const sections: string[] = [`bonjour. ${dateStr}.`];

  const accounts = await getConnectedAccounts(userId);

  if (accounts.length > 0) {
    const { timeMin, timeMax } = todayRange(tz);
    const multiAccount = accounts.length > 1;

    // ── Calendar — fan-out, merge sorted by start ────────────────────────────
    try {
      const allEventSets = await Promise.allSettled(
        accounts.map(async (a) => {
          const token = await getValidAccessToken(a.id);
          const events = await listCalendarEvents(token, { timeMin, timeMax, maxResults: 10 });
          return { label: a.label, events };
        })
      );

      const allEvents = allEventSets.flatMap((s) =>
        s.status === "fulfilled" ? s.value.events.map((e) => ({ ...e, accountLabel: s.value.label })) : []
      );
      allEvents.sort((a, b) => (a.start ?? "") > (b.start ?? "") ? 1 : -1);

      if (allEvents.length === 0) {
        sections.push("*agenda* — rien de prévu aujourd'hui.");
      } else {
        const lines = ["*agenda*"];
        for (const e of allEvents) {
          const isAllDay = !e.start?.includes("T");
          const start = isAllDay ? "journée" : formatTime(e.start, tz);
          const end = !isAllDay && e.end ? `–${formatTime(e.end, tz)}` : "";
          const acct = multiAccount ? ` (${e.accountLabel})` : "";
          lines.push(`- ${start}${end} — ${e.summary}${acct}`);
        }
        sections.push(lines.join("\n"));
      }
    } catch { console.error("[daily-brief] calendar fetch failed"); }

    // ── Inbox — per account ───────────────────────────────────────────────────
    try {
      if (!multiAccount) {
        const a = accounts[0];
        const token = await getValidAccessToken(a.id);
        const allNew = await searchEmails(token, "newer_than:1d", 50);
        const actionable = await searchEmails(token, "newer_than:1d category:primary -from:me", 10);
        if (allNew.length === 0) {
          sections.push("*inbox* — rien de nouveau depuis hier.");
        } else if (actionable.length === 0) {
          sections.push(`*inbox* — ${allNew.length} nouveaux, aucun à traiter.`);
        } else {
          const lines = [`*inbox* — ${allNew.length} nouveaux, ${actionable.length} à traiter :`];
          for (const e of actionable) {
            const from = e.from.replace(/<[^>]+>/, "").trim().replace(/"/g, "");
            lines.push(`- ${from} — ${e.subject}`);
          }
          sections.push(lines.join("\n"));
        }
      } else {
        // Multi-account: group under sub-headers
        const inboxLines: string[] = ["*inbox*"];
        for (const a of accounts) {
          try {
            const token = await getValidAccessToken(a.id);
            const actionable = await searchEmails(token, "newer_than:1d category:primary -from:me", 5);
            if (actionable.length === 0) {
              inboxLines.push(`  ${a.label} : rien à traiter`);
            } else {
              inboxLines.push(`  ${a.label} :`);
              for (const e of actionable) {
                const from = e.from.replace(/<[^>]+>/, "").trim().replace(/"/g, "");
                inboxLines.push(`  - ${from} — ${e.subject}`);
              }
            }
          } catch {
            inboxLines.push(`  ⚠️ ${a.label} : compte à reconnecter`);
          }
        }
        sections.push(inboxLines.join("\n"));
      }
    } catch { console.error("[daily-brief] inbox fetch failed"); }
  }

  if (showProjects && user?.userContext) {
    const projectLines = user.userContext
      .split("\n")
      .filter((l) => l.startsWith("[PROJECT]") || l.startsWith("[PRIORITY]"))
      .map((l) => `- ${l.replace(/^\[[^\]]+\]\s*/, "")}`);
    if (projectLines.length > 0) sections.push("*sujets en cours*\n" + projectLines.join("\n"));
  }

  if (showReminders) {
    try {
      const upcoming = await prisma.reminder.findMany({
        where: { userId, sent: false, scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" }, take: 3,
      });
      if (upcoming.length > 0) {
        const lines = ["*rappels à venir*"];
        for (const r of upcoming) {
          const time = r.scheduledAt.toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
          lines.push(`- ${time} — ${r.message}`);
        }
        sections.push(lines.join("\n"));
      }
    } catch { console.error("[daily-brief] reminders fetch failed"); }
  }

  sections.push("bonne journée.");
  return sections.join("\n\n");
}

export async function generateAndSendDailyBrief(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappNumber: true, dailyBriefEnabled: true },
  });
  if (!user?.whatsappNumber || !user.dailyBriefEnabled) return;

  const message = await generateBriefText(userId);
  await sendWhatsApp(user.whatsappNumber, message);
  await prisma.$executeRaw`UPDATE User SET dailyBriefLastSent = ${new Date().toISOString()} WHERE id = ${userId}`;
  console.log(`[daily-brief] sent to ${user.whatsappNumber}`);
}

export async function checkAndSendDailyBriefs(): Promise<void> {
  const users = await prisma.$queryRaw<{
    id: string; dailyBriefTime: string | null; timezone: string; dailyBriefLastSent: string | null;
  }[]>`SELECT id, dailyBriefTime, timezone, dailyBriefLastSent FROM User WHERE dailyBriefEnabled = 1 AND dailyBriefTime IS NOT NULL`;

  for (const user of users) {
    if (!user.dailyBriefTime) continue;
    const tz = user.timezone ?? "Europe/Paris";
    const now = new Date();
    const currentTime = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    if (currentTime !== user.dailyBriefTime) continue;
    if (user.dailyBriefLastSent) {
      const lastSentDate = new Date(user.dailyBriefLastSent).toLocaleDateString("en-CA", { timeZone: tz });
      if (lastSentDate === now.toLocaleDateString("en-CA", { timeZone: tz })) continue;
    }
    await generateAndSendDailyBrief(user.id);
  }
}
