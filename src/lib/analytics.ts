import { prisma } from "@/lib/prisma";

export const PRICE_IN_PER_M  = 3.0;   // $ per million input tokens
export const PRICE_OUT_PER_M = 15.0;

export function tokenCost(input: number, output: number) {
  return (input / 1_000_000) * PRICE_IN_PER_M + (output / 1_000_000) * PRICE_OUT_PER_M;
}

// ── Engagement ────────────────────────────────────────────────────────────────

export async function getEngagement() {
  const [dau, wau, mau, trend, heatmap] = await Promise.all([
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT userId) AS n FROM WhatsAppMessage
      WHERE direction='inbound' AND DATE(timestamp)=DATE('now')`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT userId) AS n FROM WhatsAppMessage
      WHERE direction='inbound' AND timestamp >= datetime('now','-7 days')`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT userId) AS n FROM WhatsAppMessage
      WHERE direction='inbound' AND timestamp >= datetime('now','-30 days')`,
    // 30-day daily: active users + messages split
    prisma.$queryRaw<{ day: string; inbound: number; outbound: number; dau: number }[]>`
      SELECT
        DATE(timestamp) AS day,
        SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) AS inbound,
        SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) AS outbound,
        COUNT(DISTINCT userId) AS dau
      FROM WhatsAppMessage
      WHERE timestamp >= datetime('now','-30 days')
      GROUP BY DATE(timestamp)
      ORDER BY day ASC`,
    // 24-hour time-of-day heatmap (inbound, last 30 days)
    prisma.$queryRaw<{ hour: number; count: number }[]>`
      SELECT
        CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
        COUNT(*) AS count
      FROM WhatsAppMessage
      WHERE direction='inbound' AND timestamp >= datetime('now','-30 days')
      GROUP BY CAST(strftime('%H', timestamp) AS INTEGER)
      ORDER BY hour ASC`,
  ]);

  return {
    dau: Number(dau[0]?.n ?? 0),
    wau: Number(wau[0]?.n ?? 0),
    mau: Number(mau[0]?.n ?? 0),
    trend: trend.map((r) => ({ ...r, inbound: Number(r.inbound), outbound: Number(r.outbound), dau: Number(r.dau) })),
    heatmap: (() => {
      const map = Object.fromEntries(heatmap.map((r) => [Number(r.hour), Number(r.count)]));
      return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: map[h] ?? 0 }));
    })(),
  };
}

// ── Growth & Retention ────────────────────────────────────────────────────────

export async function getRetention() {
  const [funnel, churnCount, w1, w4] = await Promise.all([
    // Signup funnel
    Promise.all([
      prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT phone) AS n FROM OtpCode`,
      prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT phone) AS n FROM OtpCode WHERE used=1`,
      prisma.user.count({ where: { status: "active" } }),
      prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT userId) AS n FROM WhatsAppMessage WHERE direction='inbound'`,
      // D7 active: inbound message within 7 days of their first inbound
      prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(DISTINCT m.userId) AS n FROM WhatsAppMessage m
        WHERE m.direction='inbound'
        AND julianday(m.timestamp) - (
          SELECT julianday(MIN(m2.timestamp)) FROM WhatsAppMessage m2
          WHERE m2.userId=m.userId AND m2.direction='inbound'
        ) <= 7
        AND julianday('now') - (
          SELECT julianday(MIN(m3.timestamp)) FROM WhatsAppMessage m3
          WHERE m3.userId=m.userId AND m3.direction='inbound'
        ) >= 7`,
    ]),
    // Churn: ever active, no inbound in last 14 days
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT u.id) AS n FROM User u
      WHERE u.status='active'
        AND EXISTS (SELECT 1 FROM WhatsAppMessage m WHERE m.userId=u.id AND m.direction='inbound')
        AND NOT EXISTS (
          SELECT 1 FROM WhatsAppMessage m2 WHERE m2.userId=u.id AND m2.direction='inbound'
          AND m2.timestamp >= datetime('now','-14 days'))`,
    // W1 retention: users who signed up ≥14 days ago AND had a message in days 7-14
    prisma.$queryRaw<{ total: number; retained: number }[]>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN EXISTS(
          SELECT 1 FROM WhatsAppMessage m WHERE m.userId=u.id AND m.direction='inbound'
          AND julianday(m.timestamp) BETWEEN julianday(u.createdAt)+7 AND julianday(u.createdAt)+14
        ) THEN 1 ELSE 0 END) AS retained
      FROM User u
      WHERE u.status='active' AND julianday('now')-julianday(u.createdAt)>=14`,
    // W4 retention: users who signed up ≥35 days ago AND had a message in days 28-35
    prisma.$queryRaw<{ total: number; retained: number }[]>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN EXISTS(
          SELECT 1 FROM WhatsAppMessage m WHERE m.userId=u.id AND m.direction='inbound'
          AND julianday(m.timestamp) BETWEEN julianday(u.createdAt)+28 AND julianday(u.createdAt)+35
        ) THEN 1 ELSE 0 END) AS retained
      FROM User u
      WHERE u.status='active' AND julianday('now')-julianday(u.createdAt)>=35`,
  ]);

  const [otpReq, otpVerified, activeUsers, msgUsers, d7Users] = funnel;

  return {
    funnel: {
      otpRequested: Number(otpReq[0]?.n ?? 0),
      otpVerified:  Number(otpVerified[0]?.n ?? 0),
      googleLinked: activeUsers,
      firstMessage: Number(msgUsers[0]?.n ?? 0),
      activeD7:     Number(d7Users[0]?.n ?? 0),
    },
    churn: Number(churnCount[0]?.n ?? 0),
    w1: w1[0]
      ? { total: Number(w1[0].total), retained: Number(w1[0].retained) }
      : { total: 0, retained: 0 },
    w4: w4[0]
      ? { total: Number(w4[0].total), retained: Number(w4[0].retained) }
      : { total: 0, retained: 0 },
  };
}

// ── Cost ──────────────────────────────────────────────────────────────────────

export async function getCost() {
  const [byModel, perDay, top10] = await Promise.all([
    prisma.$queryRaw<{ model: string; msgs: number; inputTokens: number; outputTokens: number }[]>`
      SELECT model,
        COUNT(*) AS msgs,
        COALESCE(SUM(inputTokens),0) AS inputTokens,
        COALESCE(SUM(outputTokens),0) AS outputTokens
      FROM WhatsAppMessage
      WHERE direction='outbound' AND model IS NOT NULL AND inputTokens IS NOT NULL
      GROUP BY model ORDER BY inputTokens+outputTokens DESC`,
    prisma.$queryRaw<{ day: string; inputTokens: number; outputTokens: number }[]>`
      SELECT DATE(timestamp) AS day,
        COALESCE(SUM(inputTokens),0) AS inputTokens,
        COALESCE(SUM(outputTokens),0) AS outputTokens
      FROM WhatsAppMessage
      WHERE direction='outbound' AND inputTokens IS NOT NULL
        AND timestamp >= datetime('now','-30 days')
      GROUP BY DATE(timestamp) ORDER BY day ASC`,
    prisma.$queryRaw<{ userId: string; name: string | null; email: string; inputTokens: number; outputTokens: number; msgs: number }[]>`
      SELECT u.id AS userId, u.name, u.email,
        COALESCE(SUM(m.inputTokens),0) AS inputTokens,
        COALESCE(SUM(m.outputTokens),0) AS outputTokens,
        COUNT(*) AS msgs
      FROM WhatsAppMessage m JOIN User u ON m.userId=u.id
      WHERE m.direction='outbound' AND m.inputTokens IS NOT NULL
      GROUP BY m.userId
      ORDER BY inputTokens+outputTokens DESC
      LIMIT 10`,
  ]);

  return {
    byModel: byModel.map((r) => ({ ...r, msgs: Number(r.msgs), inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens) })),
    perDay:  perDay.map((r)  => ({ ...r, inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens) })),
    top10:   top10.map((r)   => ({ ...r, inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens), msgs: Number(r.msgs) })),
  };
}

// ── Quality ───────────────────────────────────────────────────────────────────

export async function getQuality() {
  const [errorsPerDay, avgIter, overBudgetPct, correctionCount, toolStats] = await Promise.all([
    // "erreur technique" replies per day, last 30 days
    prisma.$queryRaw<{ day: string; count: number }[]>`
      SELECT DATE(timestamp) AS day, COUNT(*) AS count
      FROM WhatsAppMessage
      WHERE direction='outbound'
        AND (LOWER(body) LIKE '%erreur technique%' OR LOWER(body) LIKE '%error technique%')
        AND timestamp >= datetime('now','-30 days')
      GROUP BY DATE(timestamp) ORDER BY day ASC`,
    // Average agent loop iterations
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(CAST(agentIterations AS REAL)) AS avg
      FROM WhatsAppMessage
      WHERE direction='outbound' AND agentIterations IS NOT NULL
        AND timestamp >= datetime('now','-30 days')`,
    // % of outbound replies over 900 chars (using actual body length for all historical)
    prisma.$queryRaw<{ total: number; overBudget: number }[]>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN LENGTH(body)>900 THEN 1 ELSE 0 END) AS overBudget
      FROM WhatsAppMessage
      WHERE direction='outbound' AND timestamp >= datetime('now','-30 days')`,
    // Correction signals: messages with correction intent, last 30 days
    prisma.$queryRaw<{ day: string; count: number }[]>`
      SELECT DATE(timestamp) AS day, COUNT(*) AS count
      FROM WhatsAppMessage
      WHERE direction='inbound'
        AND timestamp >= datetime('now','-30 days')
        AND (
          LOWER(body) LIKE '%trop long%' OR
          LOWER(body) LIKE '%pas ça%' OR
          LOWER(body) LIKE '%pas ce que%' OR
          LOWER(body) LIKE '%reprends%' OR
          LOWER(body) LIKE '%relance%' OR
          LOWER(body) LIKE '%c''est pas%' OR
          LOWER(body) LIKE '%non non%' OR
          LOWER(body) LIKE '%refais%'
        )
      GROUP BY DATE(timestamp) ORDER BY day ASC`,
    // Tool call stats last 30 days
    prisma.$queryRaw<{ tool: string; total: number; successes: number }[]>`
      SELECT tool,
        COUNT(*) AS total,
        SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes
      FROM ToolCallLog
      WHERE createdAt >= datetime('now','-30 days')
      GROUP BY tool ORDER BY total DESC`,
  ]);

  const qual = overBudgetPct[0];
  const total = Number(qual?.total ?? 0);
  const over  = Number(qual?.overBudget ?? 0);

  return {
    errorsPerDay:  errorsPerDay.map((r) => ({ day: r.day, count: Number(r.count) })),
    avgIterations: avgIter[0]?.avg != null ? Math.round(Number(avgIter[0].avg) * 10) / 10 : null,
    overBudgetPct: total > 0 ? Math.round((over / total) * 100) : 0,
    correctionsByDay: correctionCount.map((r) => ({ day: r.day, count: Number(r.count) })),
    toolStats: toolStats.map((r) => ({
      tool: r.tool,
      total: Number(r.total),
      successes: Number(r.successes),
      errorRate: Number(r.total) > 0 ? Math.round(((Number(r.total) - Number(r.successes)) / Number(r.total)) * 100) : 0,
    })),
  };
}

// ── Adoption ──────────────────────────────────────────────────────────────────

export async function getAdoption() {
  const [flags, actionKinds] = await Promise.all([
    prisma.$queryRaw<{ total: number; briefOn: number; inboxOn: number }[]>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN dailyBriefEnabled=1 THEN 1 ELSE 0 END) AS briefOn,
        SUM(CASE WHEN inboxWatchEnabled=1 THEN 1 ELSE 0 END) AS inboxOn
      FROM User WHERE status='active'`,
    prisma.$queryRaw<{ kind: string; count: number }[]>`
      SELECT kind, COUNT(*) AS count
      FROM AgentAction
      WHERE createdAt >= datetime('now','-30 days')
      GROUP BY kind ORDER BY count DESC`,
  ]);

  const f = flags[0];
  const total = Number(f?.total ?? 0);

  return {
    totalActive: total,
    briefPct:    total > 0 ? Math.round((Number(f?.briefOn ?? 0) / total) * 100) : 0,
    inboxPct:    total > 0 ? Math.round((Number(f?.inboxOn ?? 0) / total) * 100) : 0,
    actionKinds: actionKinds.map((r) => ({ kind: r.kind, count: Number(r.count) })),
  };
}

// ── Job health ────────────────────────────────────────────────────────────────

export async function getJobHealth() {
  // Latest run per job
  const rows = await prisma.$queryRaw<{
    job: string; status: string; error: string | null; ranAt: string; durationMs: number | null;
  }[]>`
    SELECT job, status, error, ranAt, durationMs
    FROM JobRun
    WHERE (job, ranAt) IN (SELECT job, MAX(ranAt) FROM JobRun GROUP BY job)
    ORDER BY job ASC`;

  return rows.map((r) => ({
    job: r.job,
    status: r.status,
    error: r.error,
    ranAt: new Date(r.ranAt),
    durationMs: r.durationMs != null ? Number(r.durationMs) : null,
  }));
}

// ── "Worst today" feed ────────────────────────────────────────────────────────

export async function getWorstToday() {
  const [errors, overBudget] = await Promise.all([
    prisma.$queryRaw<{ id: string; body: string; timestamp: string; userName: string | null; userEmail: string }[]>`
      SELECT m.id, m.body, m.timestamp, u.name AS userName, u.email AS userEmail
      FROM WhatsAppMessage m JOIN User u ON m.userId=u.id
      WHERE m.direction='outbound'
        AND DATE(m.timestamp)=DATE('now')
        AND (LOWER(m.body) LIKE '%erreur technique%' OR LOWER(m.body) LIKE '%error technique%')
      ORDER BY m.timestamp DESC LIMIT 20`,
    prisma.$queryRaw<{ id: string; body: string; timestamp: string; bodyLen: number; userName: string | null; userEmail: string }[]>`
      SELECT m.id, m.body, m.timestamp, LENGTH(m.body) AS bodyLen, u.name AS userName, u.email AS userEmail
      FROM WhatsAppMessage m JOIN User u ON m.userId=u.id
      WHERE m.direction='outbound'
        AND DATE(m.timestamp)=DATE('now')
        AND LENGTH(m.body)>900
      ORDER BY bodyLen DESC LIMIT 10`,
  ]);

  return {
    errors: errors.map((r) => ({ ...r, timestamp: new Date(r.timestamp) })),
    overBudget: overBudget.map((r) => ({ ...r, timestamp: new Date(r.timestamp), bodyLen: Number(r.bodyLen) })),
  };
}
