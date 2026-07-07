import { processReminders } from "@/lib/reminder-processor";
import { checkAndSendDailyBriefs } from "@/lib/daily-brief";
import { checkAllInboxes } from "@/lib/inbox-watch";
import { syncAllContacts } from "@/lib/contact-sync";

const g = globalThis as unknown as { _schedulerStarted?: boolean };

export function startScheduler() {
  if (g._schedulerStarted) return;
  g._schedulerStarted = true;

  const runReminders = async () => {
    try {
      await processReminders();
    } catch (err) {
      console.error("[scheduler] reminders error:", err);
    }
  };

  const runBriefs = async () => {
    try {
      await checkAndSendDailyBriefs();
    } catch (err) {
      console.error("[scheduler] daily-brief error:", err);
    }
  };

  runReminders();
  setInterval(runReminders, 30_000);

  // Daily briefs: check every 60s (precision within 1 minute)
  setInterval(runBriefs, 60_000);

  // Inbox watch: check every 60s, each user's interval enforced inside checkInboxForUser
  const runInboxWatch = async () => {
    try {
      await checkAllInboxes();
    } catch (err) {
      console.error("[scheduler] inbox-watch error:", err);
    }
  };
  setInterval(runInboxWatch, 60_000);

  // Contact sync: once at startup, then every 6 hours
  const runContactSync = async () => {
    try { await syncAllContacts(); } catch (err) { console.error("[scheduler] contact-sync error:", err); }
  };
  runContactSync();
  setInterval(runContactSync, 6 * 60 * 60 * 1000);

  setInterval(() => console.log("[scheduler] alive"), 10 * 60 * 1000);

  console.log("[scheduler] started — reminders 30s, briefs 60s, inbox-watch 60s, contact-sync 6h");
}
