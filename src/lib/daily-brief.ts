import { searchEmails } from "@/lib/gmail-tools";
import { listCalendarEvents } from "@/lib/calendar-tools";
import { getValidAccessToken } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { triageEmails } from "@/lib/email-triage";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";
import { CLAUDE_API } from "@/lib/claude";
import { ADMIN_EMAIL } from "@/lib/auth";

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

function nameOf(from: string): string {
  return from.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
}

async function humanizeEmails(
  emails: Array<{ sender: string; subject: string; snippet: string }>,
  register: string,
  apiKey: string,
): Promise<string[]> {
  const tutoie = register === "tu";
  const system =
    "Tu résumes des emails importants pour un brief matinal WhatsApp. " +
    `Pour chaque email, génère exactement une phrase courte et naturelle en français (${tutoie ? "tutoiement" : "vouvoiement"}) ` +
    "décrivant ce que l'expéditeur demande ou annonce. " +
    "Commence la phrase par le nom de l'expéditeur suivi d'un espace. " +
    "Ne mentionne pas les numéros de dossier ni les références techniques. " +
    "Une ligne par email, sans numérotation.";

  const userContent = emails
    .map((e, i) =>
      `${i + 1}. De: ${e.sender} | Objet: ${e.subject}${e.snippet ? ` | Extrait: ${e.snippet.slice(0, 120)}` : ""}`
    )
    .join("\n");

  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "";
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function generateBriefText(userId: string): Promise<string> {
  const [user, adminRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, userContext: true, register: true },
    }),
    prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
  ]);

  const tz = user?.timezone ?? "Europe/Paris";
  const register = user?.register ?? "vous";
  const apiKey = adminRow?.claudeApiKey ?? null;
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const possessive = register === "tu" ? "ton" : "votre";
  const lines: string[] = [`bonjour. ${dateStr}. voici ${possessive} brief.`];

  const accounts = await getConnectedAccounts(userId);
  const multiAccount = accounts.length > 1;

  // ── Emails — triage and show only high, count the rest ───────────────────
  type HighEmail = { sender: string; subject: string; snippet: string; prefix: string };
  const highEmails: HighEmail[] = [];
  let normalCount = 0;
  let bruitCount = 0;

  if (accounts.length > 0) {
    try {
      const allEmailResults = await Promise.allSettled(
        accounts.map(async (a) => {
          const token = await getValidAccessToken(a.id);
          const emails = await searchEmails(token, "in:inbox newer_than:1d -from:me", 20);
          return { label: a.label, emails };
        })
      );

      for (const settled of allEmailResults) {
        if (settled.status !== "fulfilled") continue;
        const { label, emails } = settled.value;
        const triaged = await triageEmails(userId, emails);
        for (const e of triaged) {
          if (e.priority === "high") {
            highEmails.push({
              sender: nameOf(e.from),
              subject: e.subject,
              snippet: e.snippet ?? "",
              prefix: multiAccount ? `[${label}] ` : "",
            });
          } else if (e.priority === "normal") {
            normalCount++;
          } else {
            bruitCount++;
          }
        }
      }

      if (highEmails.length > 0) {
        const top = highEmails.slice(0, 3);
        let summaries: string[] = [];
        if (apiKey) {
          try {
            summaries = await humanizeEmails(top, register, apiKey);
          } catch {
            summaries = [];
          }
        }
        for (let i = 0; i < top.length; i++) {
          const e = top[i];
          const line = summaries[i] ?? `*${e.sender}* — ${e.subject}`;
          lines.push(`${e.prefix}${line}`);
        }
      }
    } catch { console.error("[daily-brief] email fetch failed"); }
  }

  // ── Calendar — fan-out, single line summary ───────────────────────────────
  if (accounts.length > 0) {
    try {
      const { timeMin, timeMax } = todayRange(tz);
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

      const top = allEvents.slice(0, 5);
      if (top.length === 0) {
        lines.push("agenda : rien de prévu.");
      } else {
        const parts = top.map((e) => {
          const isAllDay = !e.start?.includes("T");
          const time = isAllDay ? "journée" : formatTime(e.start, tz);
          const acct = multiAccount ? ` (${e.accountLabel})` : "";
          return `${time} ${e.summary}${acct}`;
        });
        lines.push(`agenda : ${parts.join(", ")}.`);
      }
    } catch { console.error("[daily-brief] calendar fetch failed"); }
  }

  // ── Reminders ─────────────────────────────────────────────────────────────
  try {
    const upcoming = await prisma.reminder.findMany({
      where: { userId, sent: false, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: "asc" }, take: 3,
    });
    if (upcoming.length > 0) {
      const parts = upcoming.map((r) => {
        const time = r.scheduledAt.toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
        return `${time} ${r.message}`;
      });
      lines.push(`rappels : ${parts.join(", ")}.`);
    }
  } catch { console.error("[daily-brief] reminders fetch failed"); }

  // ── Projects / priorities from userContext ────────────────────────────────
  if (user?.userContext) {
    const projectLines = user.userContext
      .split("\n")
      .filter((l) => l.startsWith("[PROJECT]") || l.startsWith("[PRIORITY]"))
      .map((l) => l.replace(/^\[[^\]]+\]\s*/, "").trim())
      .filter(Boolean);
    if (projectLines.length > 0) {
      lines.push(`en cours : ${projectLines.slice(0, 3).join(", ")}.`);
    }
  }

  // ── Noise count line ──────────────────────────────────────────────────────
  const totalOther = normalCount + bruitCount;
  if (totalOther > 0 && accounts.length > 0) {
    const normalPart = normalCount > 0 ? `${normalCount} à regarder` : "";
    const bruitPart = bruitCount > 0 ? `${bruitCount} newsletters/notifs` : "";
    const parts = [normalPart, bruitPart].filter(Boolean);
    lines.push(`+ ${totalOther} autres mails (${parts.join(", ")}), rien d'urgent.`);
  }

  return lines.join("\n");
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
    id: string; dailyBriefTime: string | null; timezone: string | null; dailyBriefLastSent: string | null;
  }[]>`SELECT id, dailyBriefTime, timezone, dailyBriefLastSent FROM User WHERE dailyBriefEnabled = 1 AND dailyBriefTime IS NOT NULL`;

  const now = new Date();

  for (const user of users) {
    if (!user.dailyBriefTime) continue;
    const tz = user.timezone ?? "Europe/Paris";

    const [th, tm] = user.dailyBriefTime.split(":").map(Number);
    if (Number.isNaN(th) || Number.isNaN(tm)) {
      console.warn(`[brief] bad time for ${user.id}: ${user.dailyBriefTime}`);
      continue;
    }
    const targetMin = th * 60 + tm;

    // h23 hourCycle avoids the "24:xx" midnight edge case
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":");
    const nowMin = Number(parts[0]) * 60 + Number(parts[1]);

    const todayDate = now.toLocaleDateString("en-CA", { timeZone: tz });
    const sentToday = user.dailyBriefLastSent
      ? new Date(user.dailyBriefLastSent).toLocaleDateString("en-CA", { timeZone: tz }) === todayDate
      : false;

    // Send when past the target time, not yet sent today, within a 3h grace window
    if (sentToday || nowMin < targetMin || nowMin - targetMin > 180) continue;

    console.log(`[brief] firing for ${user.id} (target ${user.dailyBriefTime}, now ${nowMin - targetMin}min past)`);
    await generateAndSendDailyBrief(user.id);
  }
}
