// Single entry point for "the agent thinks and replies" — shared by the WhatsApp
// webhook and the web chat API so both channels talk to the exact same brain,
// same memory, same conversation thread. Callers own everything channel-specific
// (Twilio send/typing indicator for WhatsApp, SSE emit + HTTP response for web);
// this file owns only: load context, call the model, sanitize the reply.
import { prisma } from "@/lib/prisma";
import { runAgentLoop, buildAccountsBlock } from "@/lib/claude";
import { makeTokenProvider } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { resolveContacts, formatContactsBlock } from "@/lib/contacts";
import { sanitizeReply } from "@/lib/utils";
import { ADMIN_EMAIL } from "@/lib/auth";
import { buildStampedMessages } from "@/lib/conversation-history";
import { detectRegister } from "@/lib/register";
import { buildOpenLoopsBlock } from "@/lib/open-loops";

export type Channel = "whatsapp" | "web";

export interface AgentRunnerResult {
  reply: string;
  usage: { inputTokens: number | null; outputTokens: number | null; model: string | null };
  iterations: number | null;
  latencyMs: number;
}

export async function handleUserMessage(opts: {
  userId: string;
  body: string;
  inboundMessageId: string;
  channel: Channel;
}): Promise<AgentRunnerResult> {
  const { userId, body, inboundMessageId, channel } = opts;
  const startMs = Date.now();
  const noUsage = { inputTokens: null, outputTokens: null, model: null };

  const [user, adminRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        writingStyle: true,
        ruleContext: true,
        userContext: true,
        timezone: true,
        register: true,
        dailyBriefEnabled: true,
        dailyBriefTime: true,
        inboxWatchEnabled: true,
        inboxWatchIntervalMins: true,
      },
    }),
    prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
  ]);
  const claudeApiKey = adminRow?.claudeApiKey ?? null;

  if (!user) {
    return { reply: "erreur technique, réessaie dans un instant.", usage: noUsage, iterations: null, latencyMs: Date.now() - startMs };
  }

  if (!claudeApiKey) {
    console.warn("[agent-runner] missing claudeApiKey — admin has not set the API key");
    return {
      reply: "agent non configuré — l'administrateur doit paramétrer la clé Claude.",
      usage: noUsage,
      iterations: null,
      latencyMs: Date.now() - startMs,
    };
  }

  try {
    // Datetime / timezone — needed before history stamping
    const tz = user.timezone ?? "Europe/Paris";
    const now = new Date();

    // desc + reverse = N most recent messages in chronological order. Both
    // channels share ONE conversation — no channel filter here on purpose.
    const history = await prisma.whatsAppMessage.findMany({
      where: { userId, id: { not: inboundMessageId } },
      orderBy: { timestamp: "desc" },
      take: 20,
      select: { direction: true, body: true, timestamp: true },
    });
    history.reverse();

    // Natural alternating messages — each history line is timestamp-prefixed so the
    // agent can tell "described in the past" from "true now" (see <regles_temporelles>)
    const messages = buildStampedMessages(history, body, tz);

    // Load accounts + token provider (lazy, cached per request)
    const accounts = await getConnectedAccounts(userId);
    const getToken = makeTokenProvider();
    const accountsBlock = buildAccountsBlock(accounts);
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
      where: { userId },
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

    // Open loops — durable working memory of ongoing subjects (who owes what, since when)
    const openLoopsRaw = await prisma.$queryRaw<{ title: string; createdAt: string; dueAt: string | null }[]>`
      SELECT title, createdAt, dueAt FROM OpenLoop
      WHERE userId = ${userId} AND status = 'open'
      ORDER BY (dueAt IS NULL), dueAt ASC, createdAt ASC
      LIMIT 10
    `;
    const openLoopsBlock = buildOpenLoopsBlock(
      openLoopsRaw.map((l) => ({ title: l.title, createdAt: new Date(l.createdAt), dueAt: l.dueAt ? new Date(l.dueAt) : null })),
      tz
    );

    let briefStatus: string;
    if (!user.dailyBriefEnabled) {
      briefStatus = "désactivé";
    } else {
      const briefTime = user.dailyBriefTime ?? "heure non définie";
      const lastSentRow = await prisma.$queryRaw<{ dailyBriefLastSent: string | null }[]>`
        SELECT dailyBriefLastSent FROM User WHERE id = ${userId} LIMIT 1
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

    const channelLine = channel === "web"
      ? "channel: web — même contrat de concision, limite souple 12 lignes"
      : "channel: whatsapp";

    const agentConfig = [
      `now: ${datetimeStr}`,
      channelLine,
      `accounts: ${accountsStatus}`,
      `daily brief: ${briefStatus}`,
      `inbox watch: ${inboxWatchStatus}`,
    ].join("\n");

    // Just-in-time contact resolution
    const emailsInText = (body.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []);
    const resolvedContacts = await resolveContacts(userId, body, emailsInText);
    const contactsBlock = formatContactsBlock(resolvedContacts);
    if (contactsBlock) console.log(`[agent] injecting ${resolvedContacts.length} contact(s): ${resolvedContacts.map(c => c.displayName).join(", ")}`);

    // Behavior block — register only. Tone/language are handled by register-mirroring
    // + the prompt; signatures are per-account (accountsBlock); the old guardrails
    // described tools that don't exist. Explicit dashboard choice always wins;
    // "auto" is detected from the user's own recent messages (WhatsApp default: casual/tu).
    const effectiveRegister = user.register === "auto"
      ? detectRegister(history.filter((m) => m.direction === "inbound").slice(-5).map((m) => m.body))
      : (user.register === "tu" ? "tu" : "vous");
    const behaviorContext = `Register: ${effectiveRegister === "tu" ? "tutoiement (tu)" : "vouvoiement (vous)"}`;

    console.log(`[agent-runner] calling Claude — channel=${channel} messages=${messages.length} accounts=${accounts.length}`);
    const parsed = await runAgentLoop({
      apiKey: claudeApiKey,
      ruleContext: user.ruleContext,
      userContext: user.userContext ?? "",
      writingStyle: user.writingStyle || undefined,
      behaviorContext,
      agentConfig,
      actionsRecentes: actionsBlock,
      focusCourant: focusCourant ?? undefined,
      openLoopsBlock: openLoopsBlock || undefined,
      contactsContext: contactsBlock,
      accountsBlock,
      messages,
      accounts,
      getToken,
      userId,
      tz,
    });

    console.log(`[agent-runner] reply length=${parsed.message.length}, usage: in=${parsed.usage?.inputTokens} out=${parsed.usage?.outputTokens}, iters=${parsed.iterations}`);
    const reply = sanitizeReply(parsed.message || "…");
    if (reply.length > 900) console.warn(`[agent-runner] reply over budget: ${reply.length} chars`);

    return {
      reply,
      usage: {
        inputTokens: parsed.usage?.inputTokens ?? null,
        outputTokens: parsed.usage?.outputTokens ?? null,
        model: parsed.usage?.model ?? null,
      },
      iterations: parsed.iterations,
      latencyMs: Date.now() - startMs,
    };
  } catch (err) {
    console.error("[agent-runner] error:", err instanceof Error ? err.message : err);
    return { reply: "erreur technique, réessaie dans un instant.", usage: noUsage, iterations: null, latencyMs: Date.now() - startMs };
  }
}
