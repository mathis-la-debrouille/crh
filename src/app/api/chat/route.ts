import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { waEmitter } from "@/lib/whatsapp-events";
import { handleUserMessage } from "@/lib/agent-runner";

// Module-level in-flight lock — one request per user at a time. Web chat never
// touches the onboarding state machine (that's WhatsApp's job); if the user's
// onboardingStep isn't "done" yet, it's simply left alone here.
const inFlight = new Set<string>();

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) {
    return NextResponse.json({ error: "Message must be 1-2000 characters" }, { status: 400 });
  }

  const userId = session.userId;
  if (inFlight.has(userId)) {
    return NextResponse.json({ error: "A request is already in progress" }, { status: 409 });
  }
  inFlight.add(userId);

  try {
    const inbound = await prisma.whatsAppMessage.create({
      data: { userId, direction: "inbound", body: message, from: "web", to: "vayt", channel: "web" },
    });
    waEmitter.emit("message", {
      id: inbound.id,
      direction: "inbound",
      body: inbound.body,
      from: inbound.from,
      to: inbound.to,
      timestamp: inbound.timestamp,
      channel: "web",
    });

    const startMs = Date.now();
    const result = await handleUserMessage({
      userId,
      body: message,
      inboundMessageId: inbound.id,
      channel: "web",
    });

    const outbound = await prisma.whatsAppMessage.create({
      data: {
        userId,
        direction: "outbound",
        body: result.reply,
        from: "vayt",
        to: "web",
        channel: "web",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        model: result.usage.model,
        agentIterations: result.iterations,
        latencyMs: Date.now() - startMs,
        replyOverBudget: result.reply.length > 900,
      },
    });
    waEmitter.emit("message", {
      id: outbound.id,
      direction: "outbound",
      body: outbound.body,
      from: outbound.from,
      to: outbound.to,
      timestamp: outbound.timestamp,
      channel: "web",
    });

    return NextResponse.json({ reply: result.reply });
  } finally {
    inFlight.delete(userId);
  }
}
