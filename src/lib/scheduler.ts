import { processReminders } from "@/lib/reminder-processor";
import { checkAndSendDailyBriefs } from "@/lib/daily-brief";
import { checkAllInboxes } from "@/lib/inbox-watch";
import { syncAllContacts } from "@/lib/contact-sync";
import { prisma } from "@/lib/prisma";

const g = globalThis as unknown as { _schedulerStarted?: boolean };

async function withJobRun(job: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
    prisma.jobRun.create({ data: { job, status: "ok", durationMs: Date.now() - t0 } }).catch(() => {});
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] ${job} error:`, error);
    prisma.jobRun.create({ data: { job, status: "error", error, durationMs: Date.now() - t0 } }).catch(() => {});
  }
}

export function startScheduler() {
  if (g._schedulerStarted) return;
  g._schedulerStarted = true;

  const runReminders = () => withJobRun("reminders", processReminders);
  const runBriefs    = () => withJobRun("daily_briefs", checkAndSendDailyBriefs);
  const runInbox     = () => withJobRun("inbox_watch", checkAllInboxes);
  const runContacts  = () => withJobRun("contact_sync", syncAllContacts);

  runReminders();
  setInterval(runReminders, 30_000);

  // Daily briefs: check every 60s (precision within 1 minute)
  setInterval(runBriefs, 60_000);

  // Inbox watch: check every 60s, each user's interval enforced inside checkInboxForUser
  setInterval(runInbox, 60_000);

  // Contact sync: once at startup, then every 6 hours
  runContacts();
  setInterval(runContacts, 6 * 60 * 60 * 1000);

  setInterval(() => {
    prisma.jobRun.create({ data: { job: "heartbeat", status: "ok" } }).catch(() => {});
    console.log("[scheduler] alive");
  }, 10 * 60 * 1000);

  console.log("[scheduler] started — reminders 30s, briefs 60s, inbox-watch 60s, contact-sync 6h");
}
