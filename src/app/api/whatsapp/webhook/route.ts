import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { sendWhatsApp, sendTypingIndicator } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";
import { waEmitter } from "@/lib/whatsapp-events";
import { handleUserMessage } from "@/lib/agent-runner";
import { consumeVerificationCode } from "@/lib/otp";
import { analyzeWritingStyle } from "@/lib/style-analysis";
import { isRequestLike, nextMorning930 } from "@/lib/onboarding";

function makeSilent() {
  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
const SILENT = makeSilent();

export async function POST(req: NextRequest) {
  // ── Twilio signature verification ────────────────────────────────────────
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature") ?? "";

  if (authToken && signature && process.env.NODE_ENV !== "development") {
    const url = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/whatsapp/webhook`
      : req.url;
    // Clone to read body for signature check
    const rawText = await req.text();
    const params = Object.fromEntries(new URLSearchParams(rawText));
    const valid = twilio.validateRequest(authToken, signature, url, params);
    if (!valid) {
      console.warn("[webhook] invalid Twilio signature — rejecting");
      return new NextResponse("Forbidden", { status: 403 });
    }
    // Re-parse from already-read body
    const formData = new URLSearchParams(rawText);
    return handleWebhook(req, formData);
  }

  const formData = await req.formData();
  const urlParams = new URLSearchParams();
  formData.forEach((v, k) => urlParams.set(k, v as string));
  return handleWebhook(req, urlParams);
}

async function handleWebhook(_req: NextRequest, formData: URLSearchParams) {
  const body = formData.get("Body") as string;
  const from = formData.get("From") as string;
  const to = formData.get("To") as string;
  const sid = formData.get("MessageSid") as string;

  const fromNumber = from?.replace("whatsapp:", "");
  const toNumber = to?.replace("whatsapp:", "");
  console.log(`[webhook] inbound from=${fromNumber} body="${body?.slice(0, 60)}"`);

  // ── VAYT verification codes — handle before anything else ─────────────────
  if (/^VAYT-\d{4}$/i.test(body?.trim() ?? "")) {
    const code = body.trim().toUpperCase();
    const result = await consumeVerificationCode(fromNumber, code);
    if (result.ok) {
      await sendWhatsApp(fromNumber, "verified ✓ return to the site to complete your registration.");
    } else {
      await sendWhatsApp(fromNumber, "code not found or expired — go back to the site to get a new one.");
    }
    return SILENT;
  }

  // Only what the webhook itself needs — the agent-invocation section (tone,
  // language, accounts, brief status, etc.) is loaded by handleUserMessage.
  const user = await prisma.user.findFirst({
    where: { whatsappNumber: fromNumber },
    select: {
      id: true,
      status: true,
      assistantPaused: true,
      onboardingStep: true,
      timezone: true,
      userContext: true,
      dailyBriefEnabled: true,
    },
  });

  // Reject unknown numbers and non-active accounts silently
  if (!user || user.status !== "active") {
    console.warn(`[webhook] rejected — user=${user?.id ?? "unknown"} status=${user?.status ?? "not found"}`);
    return SILENT;
  }

  // Pause guard — save message to history but don't reply
  if (user.assistantPaused) {
    console.log(`[webhook] assistant paused for userId=${user.id} — skipping reply`);
    await prisma.whatsAppMessage.create({
      data: { userId: user.id, direction: "inbound", body, from: fromNumber, to: toNumber, sid },
    });
    return SILENT;
  }

  // Save inbound message
  const inbound = await prisma.whatsAppMessage.create({
    data: { userId: user.id, direction: "inbound", body, from: fromNumber, to: toNumber, sid },
  });

  waEmitter.emit("message", {
    id: inbound.id,
    direction: "inbound",
    body: inbound.body,
    from: inbound.from,
    to: inbound.to,
    timestamp: inbound.timestamp,
    channel: "whatsapp",
  });

  sendTypingIndicator(sid); // fire-and-forget, best-effort — never blocks the reply

  // ── Onboarding state machine ──────────────────────────────────────────────
  let postOnboardingMessage: string | undefined;
  if (user.onboardingStep !== "done") {
    const onboardResult = await handleOnboarding(user, body, fromNumber, toNumber);
    if (onboardResult.fireStyleAnalysis) analyzeWritingStyle(user.id); // fire-and-forget
    postOnboardingMessage = onboardResult.postAgentMessage;
    if (onboardResult.response !== null) return onboardResult.response;
    // null = fall-through; onboardingStep already advanced inside
  }

  // ── Agent invocation — same brain as web chat (src/lib/agent-runner.ts) ───
  const webhookStartMs = Date.now();
  // Twilio's typing indicator auto-expires after 25s — re-send every ~20s
  // while the agent is still working on a reply.
  const typingInterval = setInterval(() => sendTypingIndicator(sid), 20000);

  let result: Awaited<ReturnType<typeof handleUserMessage>>;
  try {
    result = await handleUserMessage({
      userId: user.id,
      body,
      inboundMessageId: inbound.id,
      channel: "whatsapp",
    });
  } finally {
    clearInterval(typingInterval);
  }
  const replyBody = result.reply;
  const replyUsage = result.usage;
  const replyIterations = result.iterations;

  console.log(`[webhook] sending reply (${replyBody.length} chars) to ${fromNumber}`);
  try {
    const replyMsg = await sendWhatsApp(fromNumber, replyBody);
    const baseData = {
      userId: user.id,
      direction: "outbound",
      body: replyBody,
      from: toNumber,
      to: fromNumber,
      sid: replyMsg.sid,
      inputTokens: replyUsage.inputTokens,
      outputTokens: replyUsage.outputTokens,
      model: replyUsage.model,
    };
    const outbound = await prisma.whatsAppMessage.create({
      data: {
        ...baseData,
        agentIterations: replyIterations,
        latencyMs: Date.now() - webhookStartMs,
        replyOverBudget: replyBody.length > 900,
      },
    }).catch(() => prisma.whatsAppMessage.create({ data: baseData }));

    waEmitter.emit("message", {
      id: outbound.id,
      direction: "outbound",
      body: outbound.body,
      from: outbound.from,
      to: outbound.to,
      timestamp: outbound.timestamp,
      channel: "whatsapp",
    });
  } catch (err) {
    console.error("[whatsapp] send error:", err instanceof Error ? err.message : String(err));
  }

  // Onboarding follow-up (profile ask, etc.) — sent AFTER the real answer, never before
  if (postOnboardingMessage) {
    await sendAndRecord(user.id, fromNumber, toNumber, postOnboardingMessage);
  }

  console.log(`[webhook] done`);

  return new NextResponse("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}

// ── Onboarding state machine ──────────────────────────────────────────────────
// Returns a NextResponse to halt (SILENT), or null to fall through to the agent.

async function sendAndRecord(
  userId: string,
  fromNumber: string,
  toNumber: string,
  text: string,
) {
  const sent = await sendWhatsApp(fromNumber, text);
  const msg = await prisma.whatsAppMessage.create({
    data: { userId, direction: "outbound", body: text, from: toNumber, to: fromNumber, sid: sent.sid },
  });
  waEmitter.emit("message", {
    id: msg.id, direction: "outbound", body: msg.body,
    from: msg.from, to: msg.to, timestamp: msg.timestamp,
    channel: "whatsapp",
  });
}

const BRIEF_OFFER_MESSAGE =
  "au fait — je peux t'envoyer un brief chaque matin (agenda + mails à traiter). dis-moi une heure ('8h30') si tu veux.";

// Every transition to onboardingStep="done" goes through here. Schedules a
// next-morning 09:30 nudge offering the daily brief — skipped if the user
// already configured it some other way (e.g. on the site).
async function scheduleBriefOfferReminder(user: { id: string; timezone: string | null; dailyBriefEnabled: boolean }) {
  if (user.dailyBriefEnabled) return;
  const tz = user.timezone ?? "Europe/Paris";
  await prisma.reminder.create({
    data: { userId: user.id, message: BRIEF_OFFER_MESSAGE, scheduledAt: nextMorning930(tz) },
  });
}

async function saveProfileLine(userId: string, userContext: string | null, body: string) {
  const line = `[PROFILE] ${body.replace(/\n/g, " ").slice(0, 500)}`;
  const current = userContext ?? "";
  const updated = current ? `${current}\n${line}` : line;
  await prisma.user.update({ where: { id: userId }, data: { userContext: updated } });
}

interface OnboardingResult {
  response: NextResponse | null; // null = fall through to the agent
  postAgentMessage?: string;     // sent AFTER the agent's reply, never before
  fireStyleAnalysis?: boolean;
}

async function handleOnboarding(
  user: { id: string; onboardingStep: string; timezone: string | null; userContext: string | null; dailyBriefEnabled: boolean },
  body: string,
  fromNumber: string,
  toNumber: string,
): Promise<OnboardingResult> {
  const step = user.onboardingStep;

  if (step === "new") {
    console.log(`[onboarding] step=new userId=${user.id} requestLike=${isRequestLike(body)}`);

    if (isRequestLike(body)) {
      // Never swallow a real request — one-line intro, then let the agent
      // actually answer. Profile is asked for as a follow-up after the answer.
      await sendAndRecord(user.id, fromNumber, toNumber, "salut, moi c'est Vayt — je regarde ça.");
      await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: "profile" } });
      return {
        response: null,
        postAgentMessage:
          "au fait — dis-moi qui tu es en une phrase (métier, contexte), ça m'aide à trier pour toi. je lis aussi tes 25 derniers mails envoyés pour apprendre ton style d'écriture, une seule fois.",
        fireStyleAnalysis: true,
      };
    }

    // Greeting — original 3-message intro, unchanged
    await sendAndRecord(user.id, fromNumber, toNumber,
      "salut, moi c'est Vayt. je gère tes mails, ton agenda et tes rappels, directement ici.");
    await sendAndRecord(user.id, fromNumber, toNumber,
      "pour écrire comme toi, je vais lire tes 25 derniers mails envoyés et en tirer ton style — salutations, ton, longueur. ils sont analysés une fois pour créer ton profil, c'est tout.");
    await sendAndRecord(user.id, fromNumber, toNumber,
      "d'abord : dis-moi qui tu es en une ou deux phrases — ton métier, ton contexte, ce qui compte pour toi.");
    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: "profile" } });
    return { response: makeSilent(), fireStyleAnalysis: true };
  }

  if (step === "profile") {
    if (isRequestLike(body)) {
      await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: "profile_retry" } });
      return { response: null, postAgentMessage: "et pour le profil — une phrase sur toi quand tu as 30 secondes :)" };
    }

    const isSkip = /^(skip|passe|non|plus tard)\.?$/i.test(body.trim());
    if (!isSkip) await saveProfileLine(user.id, user.userContext, body);
    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: "done" } });
    await scheduleBriefOfferReminder(user);
    await sendAndRecord(user.id, fromNumber, toNumber,
      isSkip
        ? "essaie : demande-moi ce que tu as reçu d'important aujourd'hui."
        : "noté. essaie : demande-moi ce que tu as reçu d'important aujourd'hui.");
    return { response: makeSilent() };
  }

  if (step === "profile_retry") {
    await prisma.user.update({ where: { id: user.id }, data: { onboardingStep: "done" } });
    await scheduleBriefOfferReminder(user);

    if (isRequestLike(body)) {
      // Give up silently — profile will be captured organically via <memoire>
      return { response: null };
    }

    await saveProfileLine(user.id, user.userContext, body);
    await sendAndRecord(user.id, fromNumber, toNumber,
      "noté. essaie : demande-moi ce que tu as reçu d'important aujourd'hui.");
    return { response: makeSilent() };
  }

  return { response: null };
}
