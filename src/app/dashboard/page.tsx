import { getServerSession } from "next-auth";
import { authOptions, ADMIN_EMAIL } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { ConnectionCard } from "@/components/connection-card";
import { WhatsAppPanel } from "@/components/whatsapp-panel";
import { AiPanel } from "@/components/ai-panel";
import { AccountsPanel } from "@/components/accounts-panel";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");

  const [user, admin, connectedAccounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { whatsappNumber: true, whatsappConnected: true },
    }),
    prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
    prisma.emailAccount.count({ where: { userId: session.userId, connected: true } }),
  ]);

  if (!user) redirect("/");

  const claudeConnected = !!admin?.claudeApiKey;
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
          <ConnectionCard title="Claude AI" icon="🤖" connected={claudeConnected}>
            <AiPanel />
          </ConnectionCard>

          <ConnectionCard title="Email accounts" icon="📧" connected={googleConnected}>
            <AccountsPanel />
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
