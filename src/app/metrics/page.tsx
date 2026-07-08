import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;

function cost(input: number, output: number) {
  return (input / 1_000_000) * PRICE_INPUT_PER_M + (output / 1_000_000) * PRICE_OUTPUT_PER_M;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function fmtCost(n: number) {
  if (n < 0.001) return "< $0.001";
  return `$${n.toFixed(3)}`;
}

export default async function MetricsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");
  if (!session.isAdmin) redirect("/dashboard");
  const userId = session.userId;

  const [totalMessages, totalContacts, tokenAgg] = await Promise.all([
    prisma.whatsAppMessage.count({ where: { userId } }),
    prisma.contact.count({ where: { userId } }),
    prisma.$queryRaw<{ totalInput: number; totalOutput: number; aiMessages: number }[]>`
      SELECT
        COALESCE(SUM(inputTokens), 0)  AS totalInput,
        COALESCE(SUM(outputTokens), 0) AS totalOutput,
        COUNT(*)                        AS aiMessages
      FROM WhatsAppMessage
      WHERE userId = ${userId} AND direction = 'outbound' AND inputTokens IS NOT NULL
    `,
  ]);

  const daily = await prisma.$queryRaw<
    { day: string; inbound: number; outbound: number; inputTokens: number; outputTokens: number }[]
  >`
    SELECT
      DATE(timestamp) AS day,
      SUM(CASE WHEN direction = 'inbound'  THEN 1 ELSE 0 END) AS inbound,
      SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound,
      COALESCE(SUM(inputTokens), 0)  AS inputTokens,
      COALESCE(SUM(outputTokens), 0) AS outputTokens
    FROM WhatsAppMessage
    WHERE userId = ${userId} AND timestamp >= DATE('now', '-14 days')
    GROUP BY DATE(timestamp)
    ORDER BY day ASC
  `;

  const recent = await prisma.whatsAppMessage.findMany({
    where: { userId, direction: "outbound", inputTokens: { not: null } },
    orderBy: { timestamp: "desc" },
    take: 15,
    select: { id: true, body: true, timestamp: true, inputTokens: true, outputTokens: true, model: true },
  });

  const { totalInput, totalOutput, aiMessages } = tokenAgg[0];
  const totalIn = Number(totalInput);
  const totalOut = Number(totalOutput);
  const aiCount = Number(aiMessages);
  const totalCost = cost(totalIn, totalOut);
  const maxDailyTokens = daily.reduce(
    (m, d) => Math.max(m, Number(d.inputTokens) + Number(d.outputTokens)),
    1
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#0f172a]">Usage Metrics</h1>
          <p className="mt-1 text-sm text-slate-500">Token usage, message volume, and cost breakdown.</p>
        </div>

        {/* Stat cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total messages" value={fmt(Number(totalMessages))} sub="all time" />
          <StatCard label="AI responses" value={fmt(aiCount)} sub="with token data" />
          <StatCard label="Contacts" value={fmt(Number(totalContacts))} sub="in memory" />
          <StatCard label="Est. cost" value={fmtCost(totalCost)} sub="all time" accent />
        </div>

        {/* Token summary */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Input tokens" value={fmt(totalIn)} sub={`~${fmt(Math.round(totalIn / 1000))}k`} />
          <StatCard label="Output tokens" value={fmt(totalOut)} sub={`~${fmt(Math.round(totalOut / 1000))}k`} />
          <StatCard label="Avg input / msg" value={aiCount > 0 ? fmt(Math.round(totalIn / aiCount)) : "—"} sub="tokens" />
          <StatCard label="Avg output / msg" value={aiCount > 0 ? fmt(Math.round(totalOut / aiCount)) : "—"} sub="tokens" />
        </div>

        {/* Daily bar chart — last 14 days */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Daily token usage — last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No data yet.</p>
            ) : (
              <div className="space-y-2">
                {daily.map((d) => {
                  const totalTok = Number(d.inputTokens) + Number(d.outputTokens);
                  const barPct = Math.round((totalTok / maxDailyTokens) * 100);
                  const inputPct = totalTok > 0 ? Math.round((Number(d.inputTokens) / totalTok) * 100) : 50;
                  return (
                    <div key={d.day} className="flex items-center gap-3 text-xs">
                      <span className="w-20 shrink-0 text-slate-400">{d.day.slice(5)}</span>
                      <div className="flex h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-l-full bg-indigo-400"
                          style={{ width: `${barPct * inputPct / 100}%` }}
                        />
                        <div
                          className="h-full bg-violet-400"
                          style={{ width: `${barPct * (100 - inputPct) / 100}%` }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right text-slate-500">{fmt(totalTok)} tok</span>
                      <span className="w-16 shrink-0 text-right text-slate-400">{fmtCost(cost(Number(d.inputTokens), Number(d.outputTokens)))}</span>
                    </div>
                  );
                })}
                <div className="mt-3 flex gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-indigo-400" /> input</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-violet-400" /> output</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-message log */}
        <Card>
          <CardHeader>
            <CardTitle>Recent AI responses</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No AI messages logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-slate-400">
                      <th className="pb-2 pr-3 font-medium">Time</th>
                      <th className="pb-2 pr-3 font-medium">Preview</th>
                      <th className="pb-2 pr-3 text-right font-medium">In</th>
                      <th className="pb-2 pr-3 text-right font-medium">Out</th>
                      <th className="pb-2 pr-3 text-right font-medium">Total</th>
                      <th className="pb-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {recent.map((m) => {
                      const total = (m.inputTokens ?? 0) + (m.outputTokens ?? 0);
                      return (
                        <tr key={m.id} className="text-slate-600">
                          <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                            {new Date(m.timestamp).toLocaleString("fr-FR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="py-2 pr-3 max-w-xs truncate text-slate-700">{m.body.slice(0, 70)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.inputTokens ?? 0)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.outputTokens ?? 0)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmt(total)}</td>
                          <td className="py-2 text-right text-slate-400">{fmtCost(cost(m.inputTokens ?? 0, m.outputTokens ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-indigo-600" : "text-[#0f172a]"}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  );
}
