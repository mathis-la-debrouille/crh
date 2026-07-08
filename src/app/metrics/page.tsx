import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getEngagement, getRetention, getCost, getQuality, getAdoption,
  tokenCost, PRICE_IN_PER_M, PRICE_OUT_PER_M,
} from "@/lib/analytics";

function fmt(n: number, dec = 0) {
  return n.toLocaleString("en-US", { maximumFractionDigits: dec });
}
function pct(n: number) { return `${n}%`; }
function fmtCost(usd: number) {
  if (usd < 0.001) return "< $0.001";
  if (usd < 0.01)  return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
function timeSince(date: Date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function StatCard({ label, value, sub, accent, warn }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-indigo-600" : warn ? "text-red-600" : "text-[#0f172a]"}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function MiniBar({ pct: p, color = "bg-indigo-400" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(p, 100)}%` }} />
    </div>
  );
}

export default async function MetricsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");
  if (!session.isAdmin) redirect("/dashboard");

  const [engagement, retention, cost, quality, adoption, allTimeTokens, totalUsers] = await Promise.all([
    getEngagement(),
    getRetention(),
    getCost(),
    getQuality(),
    getAdoption(),
    prisma.whatsAppMessage.aggregate({
      where: { direction: "outbound", inputTokens: { not: null } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.user.count({ where: { status: "active" } }),
  ]);

  const totalIn  = allTimeTokens._sum.inputTokens  ?? 0;
  const totalOut = allTimeTokens._sum.outputTokens ?? 0;
  const totalAllTimeCost = tokenCost(totalIn, totalOut);

  const maxTrend = Math.max(...engagement.trend.map((d) => d.inbound + d.outbound), 1);
  const maxHeat  = Math.max(...engagement.heatmap.map((h) => h.count), 1);
  const maxCostDay = Math.max(...cost.perDay.map((d) => tokenCost(d.inputTokens, d.outputTokens)), 0.001);
  const maxTop10 = Math.max(...cost.top10.map((u) => u.inputTokens + u.outputTokens), 1);

  const funnelSteps = [
    { label: "OTP requested",   n: retention.funnel.otpRequested },
    { label: "OTP verified",    n: retention.funnel.otpVerified  },
    { label: "Google linked",   n: retention.funnel.googleLinked },
    { label: "First message",   n: retention.funnel.firstMessage },
    { label: "Active at D+7",   n: retention.funnel.activeD7     },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">Metrics</h1>
          <p className="mt-1 text-sm text-slate-500">Usage, cost, quality, and adoption — last 30 days unless noted.</p>
        </div>

        {/* ── 1. Engagement ───────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Engagement</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="DAU" value={fmt(engagement.dau)} sub="active today" />
            <StatCard label="WAU" value={fmt(engagement.wau)} sub="active this week" />
            <StatCard label="MAU" value={fmt(engagement.mau)} sub="active this month" />
            <StatCard label="Churn (14d)" value={fmt(retention.churn)} sub="no msg in 14 days" warn={retention.churn > 0} />
          </div>

          {/* 30-day trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Messages per day — 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              {engagement.trend.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No data yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {engagement.trend.map((d) => {
                    const total = d.inbound + d.outbound;
                    const barW = Math.round((total / maxTrend) * 100);
                    const inPct = total > 0 ? Math.round((d.inbound / total) * 100) : 50;
                    return (
                      <div key={d.day} className="flex items-center gap-3 text-xs">
                        <span className="w-14 shrink-0 text-slate-400">{d.day.slice(5)}</span>
                        <div className="flex h-4 flex-1 overflow-hidden rounded bg-slate-100">
                          <div className="h-full bg-blue-400" style={{ width: `${barW * inPct / 100}%` }} />
                          <div className="h-full bg-slate-300" style={{ width: `${barW * (100 - inPct) / 100}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-slate-400">{d.dau}u</span>
                        <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">{total} msg</span>
                      </div>
                    );
                  })}
                  <div className="mt-2 flex gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-blue-400" /> inbound</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-slate-300" /> outbound</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Time-of-day heatmap */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Time-of-day heatmap — inbound, last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-px" style={{ height: 56 }}>
                {engagement.heatmap.map(({ hour, count }) => {
                  const h = Math.round((count / maxHeat) * 100);
                  const isNight = hour < 7 || hour >= 22;
                  return (
                    <div key={hour} className="group relative flex-1 flex flex-col justify-end" title={`${hour}h — ${count} msgs`}>
                      <div
                        className={`rounded-t transition-all ${isNight ? "bg-slate-200" : "bg-indigo-400"}`}
                        style={{ height: `${Math.max(h, 2)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── 2. Growth & Retention ────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Growth & Retention</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Funnel */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Signup funnel (all time)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {funnelSteps.map((step, i) => {
                  const top = funnelSteps[0].n;
                  const p = top > 0 ? Math.round((step.n / top) * 100) : 0;
                  return (
                    <div key={step.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600">{i + 1}. {step.label}</span>
                        <span className="font-semibold tabular-nums">{fmt(step.n)} <span className="font-normal text-slate-400">({p}%)</span></span>
                      </div>
                      <MiniBar pct={p} color={i === 0 ? "bg-indigo-500" : i < 3 ? "bg-indigo-400" : "bg-green-400"} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Retention */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Retention</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "W+1 retention", desc: "% active in days 7-14 after signup", ...retention.w1 },
                  { label: "W+4 retention", desc: "% active in days 28-35 after signup", ...retention.w4 },
                ].map((r) => {
                  const p = r.total > 0 ? Math.round((r.retained / r.total) * 100) : 0;
                  return (
                    <div key={r.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <div>
                          <p className="font-medium text-slate-700">{r.label}</p>
                          <p className="text-slate-400">{r.desc}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-[#0f172a]">{pct(p)}</p>
                          <p className="text-slate-400">{r.retained}/{r.total}</p>
                        </div>
                      </div>
                      <MiniBar pct={p} color={p >= 60 ? "bg-green-400" : p >= 30 ? "bg-yellow-400" : "bg-red-400"} />
                    </div>
                  );
                })}
                <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <span className="font-medium text-red-600">{fmt(retention.churn)}</span> active users with no message in the last 14 days.
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── 3. Cost ──────────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Cost</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="All-time cost" value={fmtCost(totalAllTimeCost)} sub={`$${PRICE_IN_PER_M}/M in · $${PRICE_OUT_PER_M}/M out`} accent />
            <StatCard label="Total input" value={fmt(totalIn)} sub="tokens (all time)" />
            <StatCard label="Total output" value={fmt(totalOut)} sub="tokens (all time)" />
            <StatCard label="Active users" value={fmt(totalUsers)} sub="billed accounts" />
          </div>

          {/* Cost per day */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Daily cost — last 30 days</CardTitle></CardHeader>
            <CardContent>
              {cost.perDay.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No data yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {cost.perDay.map((d) => {
                    const c = tokenCost(d.inputTokens, d.outputTokens);
                    const barW = Math.round((c / maxCostDay) * 100);
                    return (
                      <div key={d.day} className="flex items-center gap-3 text-xs">
                        <span className="w-14 shrink-0 text-slate-400">{d.day.slice(5)}</span>
                        <div className="h-4 flex-1 rounded bg-slate-100">
                          <div className="h-4 rounded bg-violet-400" style={{ width: `${barW}%` }} />
                        </div>
                        <span className="w-16 shrink-0 text-right tabular-nums text-slate-500">{fmtCost(c)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per model */}
          {cost.byModel.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cost by model</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-slate-400">
                      <th className="pb-1.5 pr-4 font-medium">Model</th>
                      <th className="pb-1.5 pr-4 text-right font-medium">Responses</th>
                      <th className="pb-1.5 pr-4 text-right font-medium">Input tok</th>
                      <th className="pb-1.5 pr-4 text-right font-medium">Output tok</th>
                      <th className="pb-1.5 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {cost.byModel.map((m) => (
                      <tr key={m.model} className="text-slate-600">
                        <td className="py-2 pr-4 font-mono text-[10px]">{m.model}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(m.msgs)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(m.inputTokens)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(m.outputTokens)}</td>
                        <td className="py-2 text-right font-medium">{fmtCost(tokenCost(m.inputTokens, m.outputTokens))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Top 10 most expensive users */}
          {cost.top10.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 by cost</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cost.top10.map((u, i) => {
                    const c = tokenCost(u.inputTokens, u.outputTokens);
                    const barW = Math.round(((u.inputTokens + u.outputTokens) / maxTop10) * 100);
                    return (
                      <div key={u.userId} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">#{i + 1}</span>
                            <span className="font-medium text-slate-700">{u.name ?? u.email.split("@")[0]}</span>
                            <span className="text-slate-400">{u.msgs} replies</span>
                          </div>
                          <span className="font-semibold tabular-nums">{fmtCost(c)}</span>
                        </div>
                        <div className="h-1.5 w-full rounded bg-slate-100">
                          <div className="h-1.5 rounded bg-violet-400" style={{ width: `${barW}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* ── 4. Quality ───────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Quality</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Over budget"
              value={pct(quality.overBudgetPct)}
              sub="replies >900 chars"
              warn={quality.overBudgetPct > 5}
            />
            <StatCard
              label="Avg iterations"
              value={quality.avgIterations != null ? String(quality.avgIterations) : "—"}
              sub="agent loop / reply"
              warn={(quality.avgIterations ?? 0) > 3}
            />
            <StatCard
              label="Error replies"
              value={fmt(quality.errorsPerDay.reduce((s, d) => s + d.count, 0))}
              sub="'erreur technique' (30d)"
              warn={quality.errorsPerDay.reduce((s, d) => s + d.count, 0) > 0}
            />
            <StatCard
              label="Corrections"
              value={fmt(quality.correctionsByDay.reduce((s, d) => s + d.count, 0))}
              sub="correction signals (30d)"
            />
          </div>

          {/* Tool call stats */}
          {quality.toolStats.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Tool calls — last 30 days</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-slate-400">
                      <th className="pb-1.5 pr-4 font-medium">Tool</th>
                      <th className="pb-1.5 pr-4 text-right font-medium">Calls</th>
                      <th className="pb-1.5 pr-4 text-right font-medium">Errors</th>
                      <th className="pb-1.5 text-right font-medium">Error rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {quality.toolStats.map((t) => (
                      <tr key={t.tool} className="text-slate-600">
                        <td className="py-2 pr-4 font-mono text-[10px]">{t.tool}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(t.total)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-red-500">{fmt(t.total - t.successes)}</td>
                        <td className={`py-2 text-right font-medium ${t.errorRate > 10 ? "text-red-600" : "text-slate-500"}`}>
                          {pct(t.errorRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Error replies & correction signals per-day */}
          {(quality.errorsPerDay.length > 0 || quality.correctionsByDay.length > 0) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Daily failure signals — last 30 days</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-slate-400">
                        <th className="pb-1.5 pr-4 font-medium">Day</th>
                        <th className="pb-1.5 pr-4 text-right font-medium">Error replies</th>
                        <th className="pb-1.5 text-right font-medium">Correction signals</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {(() => {
                        const errMap = Object.fromEntries(quality.errorsPerDay.map((r) => [r.day, r.count]));
                        const corMap = Object.fromEntries(quality.correctionsByDay.map((r) => [r.day, r.count]));
                        const days = Array.from(new Set([...quality.errorsPerDay.map((r) => r.day), ...quality.correctionsByDay.map((r) => r.day)])).sort();
                        return days.map((day) => (
                          <tr key={day} className="text-slate-600">
                            <td className="py-1.5 pr-4 text-slate-400">{day.slice(5)}</td>
                            <td className={`py-1.5 pr-4 text-right tabular-nums ${errMap[day] ? "font-medium text-red-600" : "text-slate-300"}`}>{errMap[day] ?? 0}</td>
                            <td className={`py-1.5 text-right tabular-nums ${corMap[day] ? "font-medium text-amber-600" : "text-slate-300"}`}>{corMap[day] ?? 0}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* ── 5. Adoption ──────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Adoption</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Feature flags — active users</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Daily brief enabled", p: adoption.briefPct },
                  { label: "Inbox watch enabled", p: adoption.inboxPct },
                ].map((f) => (
                  <div key={f.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-600">{f.label}</span>
                      <span className="font-semibold">{pct(f.p)}</span>
                    </div>
                    <MiniBar pct={f.p} color="bg-emerald-400" />
                  </div>
                ))}
                <p className="text-xs text-slate-400">{fmt(adoption.totalActive)} active users total</p>
              </CardContent>
            </Card>

            {adoption.actionKinds.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Agent actions by kind — last 30 days</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(() => {
                      const maxCount = Math.max(...adoption.actionKinds.map((k) => k.count), 1);
                      return adoption.actionKinds.map((k) => (
                        <div key={k.kind} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-mono text-[10px] text-slate-600">{k.kind}</span>
                            <span className="tabular-nums font-medium">{fmt(k.count)}</span>
                          </div>
                          <MiniBar pct={Math.round((k.count / maxCount) * 100)} color="bg-purple-400" />
                        </div>
                      ));
                    })()}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
