import { getServerSession } from "next-auth";
import { authOptions, ADMIN_EMAIL } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { AccountsPanel } from "@/components/accounts-panel";
import { StatusHeader } from "@/components/dashboard/status-header";
import { DailyBriefCard } from "@/components/dashboard/daily-brief-card";
import { BehaviorCard } from "@/components/dashboard/behavior-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AccountData } from "@/components/dashboard/account-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");

  const [user, admin, emailAccounts, recentActions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        email: true,
        googleConnected: true,
        whatsappNumber: true,
        whatsappConnected: true,
        phoneVerified: true,
        assistantPaused: true,
        dailyBriefEnabled: true,
        dailyBriefTime: true,
        dailyBriefLastSent: true,
        timezone: true,
        tone: true,
        register: true,
        language: true,
        signature: true,
        guardrails: true,
      },
    }),
    prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
    prisma.emailAccount.findMany({
      where: { userId: session.userId },
      select: { email: true, connected: true },
    }),
    prisma.agentAction.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, kind: true, summary: true, refId: true, accountEmail: true, createdAt: true },
    }),
  ]);

  if (!user) redirect("/");

  const googleConnectedCount = emailAccounts.filter((a) => a.connected).length;
  const claudeReady = !!admin?.claudeApiKey;
  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Your assistant, connections, and preferences.</p>
        </div>

        {/* ── Status ── */}
        <StatusHeader
          google={{
            email: user.email,
            connected: googleConnectedCount > 0,
            accountCount: emailAccounts.length,
          }}
          whatsapp={{ connected: !!(user.whatsappNumber && user.phoneVerified), number: user.whatsappNumber }}
          twilioNumber={twilioNumber}
          initialPaused={user.assistantPaused}
        />

        {/* ── Claude not configured notice ── */}
        {!claudeReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            The AI assistant is not yet configured — contact your administrator.
          </div>
        )}

        {/* ── Daily brief + Behavior ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <DailyBriefCard
            initialEnabled={user.dailyBriefEnabled}
            initialTime={user.dailyBriefTime}
            initialTimezone={user.timezone}
            initialLastSent={user.dailyBriefLastSent}
          />
          <BehaviorCard
            initialTone={user.tone}
            initialRegister={user.register}
            initialLanguage={user.language}
            initialSignature={user.signature}
            initialGuardrails={user.guardrails}
          />
        </div>

        {/* ── Email accounts ── */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Email accounts</CardTitle>
              <span className="text-xs text-slate-400">
                {googleConnectedCount} connected
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <AccountsPanel />
          </CardContent>
        </Card>

        {/* ── Activity feed ── */}
        <ActivityFeed actions={recentActions} />

        {/* ── Account & data ── */}
        <AccountData />
      </main>
    </div>
  );
}
