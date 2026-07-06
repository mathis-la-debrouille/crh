import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/twilio";

export async function processReminders() {
  const now = new Date();

  const due = await prisma.reminder.findMany({
    where: { sent: false, scheduledAt: { lte: now } },
    include: { user: { select: { whatsappNumber: true } } },
  });

  if (due.length === 0) return;
  console.log(`[scheduler] ${due.length} reminder(s) due`);

  for (const reminder of due) {
    const number = reminder.user.whatsappNumber;
    if (!number) continue;
    try {
      await sendWhatsApp(number, reminder.message);
      await prisma.reminder.update({ where: { id: reminder.id }, data: { sent: true } });
      console.log(`[scheduler] sent reminder ${reminder.id}`);
    } catch (err) {
      console.error(`[scheduler] failed reminder ${reminder.id}:`, err);
    }
  }
}
