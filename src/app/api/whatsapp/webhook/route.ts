import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { sendWhatsApp } from "@/lib/twilio";
import { prisma } from "@/lib/prisma";
import { waEmitter } from "@/lib/whatsapp-events";
import { runAgentLoop, buildAccountsBlock } from "@/lib/claude";
import { makeTokenProvider } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { resolveContacts, formatContactsBlock } from "@/lib/contacts";
import { consumeVerificationCode } from "@/lib/otp";
import { sanitizeReply } from "@/lib/utils";
import { ADMIN_EMAIL } from "@/lib/auth";

const SILENT = new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });

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

  const [user, adminRow] = await Promise.all([
    prisma.user.findFirst({
    where: { whatsappNumber: fromNumber },
    select: {
      id: true,
      status: true,
      ruleContext: true,
      userContext: true,
      timezone: true,
      dailyBriefEnabled: true,
      dailyBriefTime: true,
      inboxWatchEnabled: true,
      inboxWatchIntervalMins: true,
    },
  }),
    prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
  ]);
  const claudeApiKey = adminRow?.claudeApiKey ?? null;

  // Reject unknown numbers and non-active accounts silently
  if (!user || user.status !== "active") {
    console.warn(`[webhook] rejected — user=${user?.id ?? "unknown"} status=${user?.status ?? "not found"}`);
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
  });

  // ── First-ever message → onboarding flow ─────────────────────────────────
  const inboundCount = await prisma.whatsAppMessage.count({
    where: { userId: user.id, direction: "inbound" },
  });

  if (inboundCount === 1) {
    console.log(`[webhook] first message from userId=${user.id} — sending onboarding`);

    const onboardingMessages = [
      "salut :) je suis ton assistant — mails, agenda, rappels.",
      "tu veux un brief chaque matin (agenda + mails à traiter) ? dis-moi une heure ('8h30') ou 'plus tard'.",
    ];

    for (const text of onboardingMessages) {
      const sent = await sendWhatsApp(fromNumber, text);
      await prisma.whatsAppMessage.create({
        data: {
          userId: user.id,
          direction: "outbound",
          body: text,
          from: toNumber,
          to: fromNumber,
          sid: sent.sid,
        },
      });
    }

    return new NextResponse("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  }

  let replyBody: string;
  let replyUsage: { inputTokens: number; outputTokens: number; model: string } | null = null;

  if (claudeApiKey) {
    try {
      // §1 FIX: desc + reverse = 20 most recent messages in chronological order
      const history = await prisma.whatsAppMessage.findMany({
        where: { userId: user.id, id: { not: inbound.id } },
        orderBy: { timestamp: "desc" },
        take: 20,
        select: { direction: true, body: true },
      });
      history.reverse();

      // Natural alternating messages — no artificial markers, no bridge turn
      const messages: { role: "user" | "assistant"; content: string }[] = [];
      for (const msg of history) {
        const role = msg.direction === "inbound" ? "user" : "assistant";
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === role) {
          lastMsg.content += `\n${msg.body}`;
        } else {
          messages.push({ role, content: msg.body });
        }
      }
      // Current message appended naturally
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        lastMsg.content += `\n${body}`;
      } else {
        messages.push({ role: "user", content: body });
      }

      // Load accounts + token provider (lazy, cached per request)
      const accounts = await getConnectedAccounts(user.id);
      const getToken = makeTokenProvider();
      const accountsBlock = buildAccountsBlock(accounts);

      // Datetime in system prompt, not in the message
      const tz = user.timezone ?? "Europe/Paris";
      const now = new Date();
      const datetimeStr = now.toLocaleString("fr-FR", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      // Recent actions log — so Claude remembers what it created
      const recentActions = await prisma.agentAction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      const sortedActions = [...recentActions].reverse();
      const actionsBlock = sortedActions.length
        ? sortedActions
            .map((a) => `- ${a.kind}${a.refId ? ` (${a.refId})` : ""} : ${a.summary}`)
            .join("\n")
        : "aucune";

      // The most recent action = focus courant (for pronoun resolution: "le", "ça", "réessaie")
      const lastAction = sortedActions[sortedActions.length - 1];
      const accountLabel = lastAction?.accountEmail
        ? (accounts.find((a) => a.email === lastAction.accountEmail)?.label ?? lastAction.accountEmail)
        : null;
      const focusCourant = lastAction
        ? `${lastAction.kind}${lastAction.refId ? ` (${lastAction.refId})` : ""}${accountLabel ? ` [${accountLabel}]` : ""} : ${lastAction.summary}`
        : null;

      let briefStatus: string;
      if (!user.dailyBriefEnabled) {
        briefStatus = "désactivé";
      } else {
        const briefTime = user.dailyBriefTime ?? "heure non définie";
        const lastSentRow = await prisma.$queryRaw<{ dailyBriefLastSent: string | null }[]>`
          SELECT dailyBriefLastSent FROM User WHERE id = ${user.id} LIMIT 1
        `;
        const lastSent = lastSentRow[0]?.dailyBriefLastSent;
        const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
        const lastSentDay = lastSent
          ? new Date(lastSent).toLocaleDateString("en-CA", { timeZone: tz })
          : null;
        const sentToday = lastSentDay === todayStr;
        const lastSentLabel = sentToday
          ? `envoyé aujourd'hui à ${new Date(lastSent!).toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}`
          : lastSent
          ? `dernière envoi : ${new Date(lastSent).toLocaleDateString("fr-FR", { timeZone: tz })}`
          : "jamais envoyé";
        briefStatus = `activé — ${briefTime} chaque matin | contenu : agenda du jour + emails à traiter | ${lastSentLabel}`;
      }

      const inboxWatchStatus = user.inboxWatchEnabled
        ? `enabled — checking every ${user.inboxWatchIntervalMins ?? 15} min`
        : "disabled";

      const accountsStatus = accounts.length === 0
        ? "none"
        : accounts.map((a) => `${a.label} (${a.connected ? "ok" : "disconnected"})`).join(", ");

      const agentConfig = [
        `now: ${datetimeStr}`,
        `accounts: ${accountsStatus}`,
        `daily brief: ${briefStatus}`,
        `inbox watch: ${inboxWatchStatus}`,
      ].join("\n");

      // Just-in-time contact resolution
      const emailsInText = (body.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []);
      const resolvedContacts = await resolveContacts(user.id, body, emailsInText);
      const contactsBlock = formatContactsBlock(resolvedContacts);
      if (contactsBlock) console.log(`[agent] injecting ${resolvedContacts.length} contact(s): ${resolvedContacts.map(c => c.displayName).join(", ")}`);

      console.log(`[webhook] calling Claude — messages: ${messages.length}, accounts: ${accounts.length}`);
      const parsed = await runAgentLoop({
        apiKey: claudeApiKey,
        ruleContext: user.ruleContext,
        userContext: user.userContext ?? "",
        agentConfig,
        actionsRecentes: actionsBlock,
        focusCourant: focusCourant ?? undefined,
        contactsContext: contactsBlock,
        accountsBlock,
        messages,
        accounts,
        getToken,
        userId: user.id,
      });

      console.log(`[webhook] Claude reply length: ${parsed.message.length}, usage: in=${parsed.usage?.inputTokens} out=${parsed.usage?.outputTokens}`);
      replyBody = sanitizeReply(parsed.message || "…");
      if (replyBody.length > 900) console.warn(`[webhook] reply over budget: ${replyBody.length} chars`);
      replyUsage = parsed.usage;
    } catch (err) {
      console.error("[claude] error:", err instanceof Error ? err.message : err);
      replyBody = "erreur technique, réessaie dans un instant.";
    }
  } else {
    console.warn("[webhook] missing claudeApiKey — admin has not set the API key");
    replyBody = "agent non configuré — l'administrateur doit paramétrer la clé Claude.";
  }

  console.log(`[webhook] sending reply (${replyBody.length} chars) to ${fromNumber}`);
  try {
    const replyMsg = await sendWhatsApp(fromNumber, replyBody);
    const outbound = await prisma.whatsAppMessage.create({
      data: {
        userId: user.id,
        direction: "outbound",
        body: replyBody,
        from: toNumber,
        to: fromNumber,
        sid: replyMsg.sid,
        inputTokens: replyUsage?.inputTokens ?? null,
        outputTokens: replyUsage?.outputTokens ?? null,
        model: replyUsage?.model ?? null,
      },
    });

    waEmitter.emit("message", {
      id: outbound.id,
      direction: "outbound",
      body: outbound.body,
      from: outbound.from,
      to: outbound.to,
      timestamp: outbound.timestamp,
    });
  } catch (err) {
    console.error("[whatsapp] send error:", err instanceof Error ? err.message : String(err));
  }
  console.log(`[webhook] done`);

  return new NextResponse("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
