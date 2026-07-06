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

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      googleConnected: true,
      whatsappNumber: true,
      whatsappConnected: true,
      claudeApiKey: true,
    },
  });

  if (!user) redirect("/");

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

          <ConnectionCard title="Gmail" icon="📧" connected={user.googleConnected}>
            {user.googleConnected ? (
              <EmailList />
            ) : (
              <p className="text-sm text-slate-500">Sign in with Google to connect Gmail.</p>
            )}
          </ConnectionCard>

          <ConnectionCard title="Google Calendar" icon="📅" connected={user.googleConnected}>
            {user.googleConnected ? (
              <CalendarList />
            ) : (
              <p className="text-sm text-slate-500">Sign in with Google to connect Calendar.</p>
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
