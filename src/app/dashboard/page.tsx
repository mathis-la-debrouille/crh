import { getServerSession } from "next-auth";
import { authOptions, ADMIN_EMAIL } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");

  const [user, admin, emailAccounts, recentActions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        whatsappNumber: true,
        phoneVerified: true,
        assistantPaused: true,
        dailyBriefEnabled: true,
        dailyBriefTime: true,
      },
    }),
    prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
    prisma.emailAccount.findMany({
      where: { userId: session.userId },
      select: { connected: true },
    }),
    prisma.agentAction.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, kind: true, summary: true, refId: true, accountEmail: true, createdAt: true },
    }),
  ]);

  if (!user) redirect("/");

  const accountsCount = emailAccounts.filter((a) => a.connected).length;
  const claudeReady = !!admin?.claudeApiKey;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        {!claudeReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            L&apos;assistant IA n&apos;est pas encore configuré — contacte ton administrateur.
          </div>
        )}

        <DashboardShell
          whatsapp={{ connected: !!(user.whatsappNumber && user.phoneVerified), number: user.whatsappNumber }}
          accountsCount={accountsCount}
          initialPaused={user.assistantPaused}
          brief={{ enabled: user.dailyBriefEnabled, time: user.dailyBriefTime }}
          recentActions={recentActions}
        />
      </main>
    </div>
  );
}
