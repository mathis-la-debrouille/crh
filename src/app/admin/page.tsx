import { getServerSession } from "next-auth";
import { authOptions, ADMIN_EMAIL } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminWhitelist } from "@/components/admin-whitelist";

const COST_PER_M_IN = 3;    // $3 per million input tokens
const COST_PER_M_OUT = 15;  // $15 per million output tokens

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function fmtCost(usd: number) {
  if (usd < 0.01) return "< $0.01";
  return `$${usd.toFixed(2)}`;
}

function timeSince(date: Date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId || session.user?.email !== ADMIN_EMAIL) redirect("/dashboard");

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

  const [
    users,
    numbers,
    totalMessages,
    todayMessages,
    tokenAgg,
    recentMessages,
    recentActions,
  ] = await Promise.all([
    // Users
    prisma.user.findMany({
      select: {
        id: true, email: true, name: true, status: true,
        phoneVerified: true, whatsappNumber: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // Whitelist
    prisma.allowedNumber.findMany({ orderBy: { createdAt: "desc" } }),
    // Total message count
    prisma.whatsAppMessage.count(),
    // Today's message count
    prisma.whatsAppMessage.count({ where: { timestamp: { gte: todayStart } } }),
    // Token aggregates (outbound messages only — those have usage data)
    prisma.whatsAppMessage.aggregate({
      where: { direction: "outbound", inputTokens: { not: null } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    // Recent activity feed (last 40 messages across all users)
    prisma.whatsAppMessage.findMany({
      orderBy: { timestamp: "desc" },
      take: 40,
      select: {
        id: true, direction: true, body: true, timestamp: true,
        inputTokens: true, outputTokens: true,
        user: { select: { name: true, email: true } },
      },
    }),
    // Recent agent actions
    prisma.agentAction.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, kind: true, summary: true, createdAt: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  // Per-user message counts
  const msgCountsRaw = await prisma.whatsAppMessage.groupBy({
    by: ["userId"],
    _count: { id: true },
  });
  const msgCounts = Object.fromEntries(msgCountsRaw.map((r) => [r.userId, r._count.id]));

  // Per-user token usage
  const userTokens = await Promise.all(
    users.map(async (u) => {
      const agg = await prisma.whatsAppMessage.aggregate({
        where: { userId: u.id, direction: "outbound", inputTokens: { not: null } },
        _sum: { inputTokens: true, outputTokens: true },
      });
      return { userId: u.id, inputTokens: agg._sum.inputTokens ?? 0, outputTokens: agg._sum.outputTokens ?? 0 };
    })
  );
  const tokensByUser = Object.fromEntries(userTokens.map((t) => [t.userId, t]));

  const totalInput = tokenAgg._sum.inputTokens ?? 0;
  const totalOutput = tokenAgg._sum.outputTokens ?? 0;
  const totalCost = (totalInput / 1_000_000) * COST_PER_M_IN + (totalOutput / 1_000_000) * COST_PER_M_OUT;
  const activeUsers = users.filter((u) => u.status === "active").length;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">Admin</h1>
          <p className="mt-1 text-sm text-slate-500">System overview, accounts, and activity.</p>
        </div>

        {/* ── Summary stats ── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Active users", value: fmt(activeUsers), sub: `${fmt(users.length)} total` },
            { label: "Messages today", value: fmt(todayMessages), sub: `${fmt(totalMessages)} all-time` },
            { label: "Total tokens", value: fmt(totalInput + totalOutput), sub: `${fmt(totalInput)} in · ${fmt(totalOutput)} out` },
            { label: "Estimated cost", value: fmtCost(totalCost), sub: "all-time at list price" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-[#0f172a]">{s.value}</p>
                <p className="mt-0.5 text-xs text-slate-400">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Users ── */}
        <Card>
          <CardHeader><CardTitle>Users ({users.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Name / Email</th>
                    <th className="pb-2 pr-4 font-medium">Phone</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Messages</th>
                    <th className="pb-2 pr-4 font-medium">Tokens (in/out)</th>
                    <th className="pb-2 pr-4 font-medium">Cost</th>
                    <th className="pb-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {users.map((u) => {
                    const tok = tokensByUser[u.id];
                    const cost = tok
                      ? (tok.inputTokens / 1_000_000) * COST_PER_M_IN + (tok.outputTokens / 1_000_000) * COST_PER_M_OUT
                      : 0;
                    return (
                      <tr key={u.id} className="text-slate-600">
                        <td className="py-2.5 pr-4">
                          <div className="font-medium text-[#0f172a]">{u.name ?? "—"}</div>
                          <div className="text-slate-400">{u.email}</div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="font-mono">{u.whatsappNumber ?? <span className="text-slate-300">—</span>}</span>
                          {u.phoneVerified && <span className="ml-1 text-green-500 text-xs">✓</span>}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.status === "active"    ? "bg-green-100 text-green-700" :
                            u.status === "pending"   ? "bg-yellow-100 text-yellow-700" :
                            u.status === "suspended" ? "bg-red-100 text-red-700" :
                            "bg-slate-100 text-slate-500"
                          }`}>
                            {u.status}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">{fmt(msgCounts[u.id] ?? 0)}</td>
                        <td className="py-2.5 pr-4">
                          {tok ? `${fmt(tok.inputTokens)} / ${fmt(tok.outputTokens)}` : "—"}
                        </td>
                        <td className="py-2.5 pr-4">{cost > 0 ? fmtCost(cost) : "—"}</td>
                        <td className="py-2.5 text-slate-400">
                          {new Date(u.createdAt).toLocaleDateString("en-GB")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── Activity feed ── */}
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              {recentMessages.map((m) => (
                <div key={m.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-px text-xs font-medium ${
                    m.direction === "inbound"
                      ? "bg-blue-50 text-blue-600"
                      : "bg-slate-100 text-slate-500"
                  }`}>
                    {m.direction === "inbound" ? "user" : "vayt"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-[#0f172a]">{m.body}</p>
                    <p className="text-xs text-slate-400">
                      {m.user.name ?? m.user.email}
                      {m.inputTokens ? ` · ${fmt(m.inputTokens + (m.outputTokens ?? 0))} tok` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-300">{timeSince(new Date(m.timestamp))}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Agent actions ── */}
        {recentActions.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recent agent actions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-0.5">
                {recentActions.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                    <span className="mt-0.5 shrink-0 rounded-full bg-purple-50 px-2 py-px text-xs font-medium text-purple-600">
                      {a.kind}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-xs text-[#0f172a]">{a.summary}</p>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-slate-400">{a.user.name}</p>
                      <p className="text-xs text-slate-300">{timeSince(new Date(a.createdAt))}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Whitelist ── */}
        <Card>
          <CardHeader><CardTitle>Phone whitelist</CardTitle></CardHeader>
          <CardContent>
            <AdminWhitelist initialNumbers={numbers} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
