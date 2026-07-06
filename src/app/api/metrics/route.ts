import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Pricing: claude-sonnet-4-6 (per 1M tokens)
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;

function cost(input: number, output: number) {
  return (input / 1_000_000) * PRICE_INPUT_PER_M + (output / 1_000_000) * PRICE_OUTPUT_PER_M;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  // Totals
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

  const { totalInput, totalOutput, aiMessages } = tokenAgg[0];

  // Per-day breakdown — last 30 days
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
    WHERE userId = ${userId}
      AND timestamp >= DATE('now', '-30 days')
    GROUP BY DATE(timestamp)
    ORDER BY day ASC
  `;

  // Recent messages with token detail
  const recent = await prisma.whatsAppMessage.findMany({
    where: { userId, direction: "outbound", inputTokens: { not: null } },
    orderBy: { timestamp: "desc" },
    take: 20,
    select: { id: true, body: true, timestamp: true, inputTokens: true, outputTokens: true, model: true },
  });

  return NextResponse.json({
    summary: {
      totalMessages: Number(totalMessages),
      totalContacts: Number(totalContacts),
      aiMessages: Number(aiMessages),
      totalInputTokens: Number(totalInput),
      totalOutputTokens: Number(totalOutput),
      totalTokens: Number(totalInput) + Number(totalOutput),
      estimatedCostUsd: cost(Number(totalInput), Number(totalOutput)),
      avgInputPerMessage: aiMessages > 0 ? Math.round(Number(totalInput) / Number(aiMessages)) : 0,
      avgOutputPerMessage: aiMessages > 0 ? Math.round(Number(totalOutput) / Number(aiMessages)) : 0,
    },
    daily: daily.map((d) => ({
      day: d.day,
      inbound: Number(d.inbound),
      outbound: Number(d.outbound),
      inputTokens: Number(d.inputTokens),
      outputTokens: Number(d.outputTokens),
      cost: cost(Number(d.inputTokens), Number(d.outputTokens)),
    })),
    recent: recent.map((m) => ({
      id: m.id,
      preview: m.body.slice(0, 80),
      timestamp: m.timestamp,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      totalTokens: (m.inputTokens ?? 0) + (m.outputTokens ?? 0),
      model: m.model,
      cost: cost(m.inputTokens ?? 0, m.outputTokens ?? 0),
    })),
  });
}
