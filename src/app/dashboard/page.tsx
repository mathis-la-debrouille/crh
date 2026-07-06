import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { ConnectionCard } from "@/components/connection-card";
import { EmailList } from "@/components/email-list";
import { CalendarList } from "@/components/calendar-list";
import { WhatsAppPanel } from "@/components/whatsapp-panel";
import { AiPanel } from "@/components/ai-panel";
import { AccountsPanel } from "@/components/accounts-panel";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { whatsappNumber: true, whatsappConnected: true, claudeApiKey: true },
  });

  if (!user) redirect("/");

  const connectedAccounts = await prisma.emailAccount.count({
    where: { userId: session.userId, connected: true },
  });
  const googleConnected = connectedAccounts > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#0f172a]">Connected Services</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your integrations and agent configuration.
          </p>
        </div>

        <div className="space-y-6">
          <ConnectionCard title="Claude AI" icon="🤖" connected={!!user.claudeApiKey}>
            <AiPanel initialConnected={!!user.claudeApiKey} />
          </ConnectionCard>

          <ConnectionCard title="Email accounts" icon="📧" connected={googleConnected}>
            <AccountsPanel />
            {googleConnected && <div className="mt-4 pt-4 border-t border-slate-100"><EmailList /></div>}
          </ConnectionCard>

          <ConnectionCard title="Google Calendar" icon="📅" connected={googleConnected}>
            {googleConnected ? (
              <CalendarList />
            ) : (
              <p className="text-sm text-slate-500">Connect a Google account to access Calendar.</p>
            )}
          </ConnectionCard>

          <ConnectionCard title="WhatsApp" icon="💬" connected={user.whatsappConnected}>
            <WhatsAppPanel
              initialNumber={user.whatsappNumber}
              initialConnected={user.whatsappConnected}
            />
          </ConnectionCard>
        </div>
      </main>
    </div>
  );
}
