import { searchEmails } from "@/lib/gmail-tools";
import { listCalendarEvents } from "@/lib/calendar-tools";
import { getValidAccessToken } from "@/lib/google";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";

function todayRange(tz: string): { timeMin: string; timeMax: string } {
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  return {
    timeMin: `${localDate}T00:00:00`,
    timeMax: `${localDate}T23:59:59`,
  };
}

function formatTime(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export async function generateBriefText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, googleConnected: true, userContext: true },
  });

  // Parse brief content preferences from userContext
  const briefContentLine = user?.userContext
    ?.split("\n")
    .find((l) => l.toLowerCase().includes("brief_content"));
  const briefContent = briefContentLine?.toLowerCase() ?? "";
  const showCalendar = true; // always
  const showEmails = true; // always
  const showProjects = briefContent.includes("sujets") || briefContent.includes("projet");
  const showReminders = briefContent.includes("rappel");

  const tz = user?.timezone ?? "Europe/Paris";
  const now = new Date();

  const dateStr = now.toLocaleDateString("fr-FR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const sections: string[] = [`bonjour mathis. ${dateStr}.`];

  if (user?.googleConnected) {
    let accessToken: string | null = null;
    try {
      accessToken = await getValidAccessToken(userId);
    } catch {
      console.error("[daily-brief] google token unavailable");
    }

    if (accessToken) {
      // ── Agenda ──────────────────────────────────────────────────────────────
      try {
        const { timeMin, timeMax } = todayRange(tz);
        const events = await listCalendarEvents(accessToken, { timeMin, timeMax, maxResults: 10 });

        if (events.length === 0) {
          sections.push("*agenda* — rien de prévu aujourd'hui.");
        } else {
          const lines = ["*agenda*"];
          for (const e of events) {
            const isAllDay = !e.start?.includes("T");
            const start = isAllDay ? "journée" : formatTime(e.start, tz);
            const end = !isAllDay && e.end ? `–${formatTime(e.end, tz)}` : "";
            lines.push(`- ${start}${end} — ${e.summary}`);
          }
          sections.push(lines.join("\n"));
        }
      } catch {
        console.error("[daily-brief] calendar fetch failed");
      }

      // ── Inbox ────────────────────────────────────────────────────────────────
      try {
        // Total new emails since yesterday
        const allNew = await searchEmails(accessToken, "newer_than:1d", 50);
        const totalCount = allNew.length;

        // Actionable = category:primary only (real people, not automated)
        const actionable = await searchEmails(
          accessToken,
          "newer_than:1d category:primary -from:me",
          10
        );

        if (totalCount === 0) {
          sections.push("*inbox* — rien de nouveau depuis hier.");
        } else if (actionable.length === 0) {
          sections.push(`*inbox* — ${totalCount} nouveaux, aucun à traiter.`);
        } else {
          const lines = [`*inbox* — ${totalCount} nouveaux, ${actionable.length} à traiter :`];
          for (const e of actionable) {
            const from = e.from.replace(/<[^>]+>/, "").trim().replace(/"/g, "");
            lines.push(`- ${from} — ${e.subject}`);
          }
          sections.push(lines.join("\n"));
        }
      } catch {
        console.error("[daily-brief] gmail fetch failed");
      }
    }
  }

  // ── Projects / ongoing topics ────────────────────────────────────────────
  if (showProjects && user?.userContext) {
    const projectLines = user.userContext
      .split("\n")
      .filter((l) => l.startsWith("[PROJECT]") || l.startsWith("[PRIORITY]"))
      .map((l) => `- ${l.replace(/^\[[^\]]+\]\s*/, "")}`);
    if (projectLines.length > 0) {
      sections.push("*sujets en cours*\n" + projectLines.join("\n"));
    }
  }

  // ── Upcoming reminders ───────────────────────────────────────────────────
  if (showReminders) {
    try {
      const upcoming = await prisma.reminder.findMany({
        where: { userId, sent: false, scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: 3,
      });
      if (upcoming.length > 0) {
        const lines = ["*rappels à venir*"];
        for (const r of upcoming) {
          const time = r.scheduledAt.toLocaleTimeString("fr-FR", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
          });
          lines.push(`- ${time} — ${r.message}`);
        }
        sections.push(lines.join("\n"));
      }
    } catch {
      console.error("[daily-brief] reminders fetch failed");
    }
  }

  // suppress unused var warnings
  void showCalendar;
  void showEmails;

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

  await prisma.$executeRaw`
    UPDATE User SET dailyBriefLastSent = ${new Date().toISOString()} WHERE id = ${userId}
  `;

  console.log(`[daily-brief] sent to ${user.whatsappNumber}`);
}

export async function checkAndSendDailyBriefs(): Promise<void> {
  const users = await prisma.$queryRaw<
    {
      id: string;
      dailyBriefTime: string | null;
      timezone: string;
      dailyBriefLastSent: string | null;
    }[]
  >`SELECT id, dailyBriefTime, timezone, dailyBriefLastSent FROM User WHERE dailyBriefEnabled = 1 AND dailyBriefTime IS NOT NULL`;

  for (const user of users) {
    if (!user.dailyBriefTime) continue;

    const tz = user.timezone ?? "Europe/Paris";
    const now = new Date();

    const currentTime = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (currentTime !== user.dailyBriefTime) continue;

    if (user.dailyBriefLastSent) {
      const lastSentDate = new Date(user.dailyBriefLastSent).toLocaleDateString("en-CA", {
        timeZone: tz,
      });
      const todayDate = now.toLocaleDateString("en-CA", { timeZone: tz });
      if (lastSentDate === todayDate) continue;
    }

    await generateAndSendDailyBrief(user.id);
  }
}
