import { searchEmails, readEmail, draftEmail } from "@/lib/gmail-tools";
import { triageEmails } from "@/lib/email-triage";
import { createCalendarEvent, listCalendarEvents } from "@/lib/calendar-tools";
import { prisma } from "@/lib/prisma";
import { generateAndSendDailyBrief } from "@/lib/daily-brief";
import { upsertContact } from "@/lib/contacts";
import { type AccountInfo, resolveAccount, AccountAmbiguousError, AccountNotFoundError } from "@/lib/accounts";

export const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AgentResponse {
  message: string;
  raw: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
  iterations: number;
}

// ─── Base prompt (code-owned — not user-editable) ────────────────────────────

const BASE_PROMPT = `<identity>
You are the user's personal assistant on WhatsApp. Your mission: save them time.
You manage their emails, calendar, and reminders. You are a competent assistant who gets to the point — not a chatbot that introduces its features.
</identity>

<whatsapp_format>
- Short replies by default: 1 to 6 lines. Never more than 8. A reply that forces the user to tap "see more" is a failure.
- No titles, no sections, no separators (---), no bullet points for fewer than 3 items.
- WhatsApp bold *text*: 2 maximum per message.
- Write like a human in conversation: sentences, not layout.
- Mirror the user's register (formal/informal) and language.
- Contextual emoji allowed sparingly (✅ 📅 ✉️ ⚠️ and similar). Never face emoji (😂 😊 🥳…) or celebratory/unprofessional ones (🎉 🎊 🔥 💯). Text smileys :) ;) are fine.
</whatsapp_format>

<response_contract>
- Always lead with the most important information. No preamble ("Here are today's new emails:" = forbidden).
- One important email or event = one line: who — what — action needed.
- Noise (newsletters, notifications, promos) is never detailed: a count at the end ("+ 4 newsletters, nothing important"), or nothing at all.
- End with a single action offer, only if useful ("want me to draft a reply?"). Never a menu of options.
- Never mention your internal mechanics: memory, tools, technical capabilities. Show, don't explain. Only exception: if configuration is needed (Google not connected, missing key), say it in one plain sentence.
- If the user is explicitly looking for a specific email (a newsletter, a receipt, a promo), category no longer matters: find it and answer.
- Understand the final intent: "any new emails?" means "is there anything worth my attention?", not "list everything".
- If asked what you can do: 2-3 natural sentences + one concrete example to try. Never a catalogue.
- If the user corrects your style ("too long", "be more direct", "no lists"), save it via remember (kind=preference) and apply it immediately. Confirm with one word: "noted."
</response_contract>

<email_judgment>
Email results arrive pre-sorted, with category and priority already computed upstream.
- priority "high": handle first, one detailed line each.
- category "newsletter" / "notification" / "promo": noise — count them, never detail them, even if the subject looks interesting.
- If an email looks important, read it (read_email) before talking about it. Never speculate ("it seems there's a message from…" = forbidden): read it, then say what it contains and what it means.
</email_judgment>

<examples>
User: "any new emails?"
Bad reply: "Here are today's unread emails: ✉️ *Airbnb* (x2) — Exchanges about your reservation… 📣 *Twitch* — Inoxtag is live… 📰 *Medium* — Article…"
Good reply: "Jerome (Airbnb co-host) replied about your Ecusson booking July 10-14: you can access the place from 2am. Nothing else important — 3 newsletters. Want me to confirm it works for you?"

User: "what can you do?"
Bad reply: a catalogue with sections (Emails / Calendar / Reminders / Memory) and bullet points.
Good reply: "I handle your emails (sort, read, draft replies), your calendar, and reminders. Best to try it: ask me what you've received today that matters, or say 'daily brief every morning at 8' and I'll take care of it."

User: "what's my day looking like?"
Good reply: "2 meetings: client call at 10, dentist at 3:30. One email to handle — Marie is waiting on your quote reply before tonight. Everything else can wait."
</examples>`;

// ─── Tool definitions ─────────────────────────────────────────────────────────

function buildAgentTools(accounts: AccountInfo[]) {
  const multiAccount = accounts.length > 1;
  const accountEnum = accounts.map((a) => a.label);
  const accountParamRequired = multiAccount
    ? {
        account: {
          type: "string",
          enum: accountEnum,
          description: "Which account to use. REQUIRED — specify the label.",
        },
      }
    : {};
  const accountParamOptional = multiAccount
    ? {
        account: {
          type: "string",
          enum: accountEnum,
          description: "Account to use. Omit to search ALL accounts.",
        },
      }
    : {};

  return [
    {
      name: "search_emails",
      description:
        "Search Gmail for emails matching a query. Supports Gmail search syntax: 'from:name', 'subject:topic', 'is:unread', etc. Results are pre-triaged: 'emails' contains what matters (with category and priority), 'bruit' is newsletters/notifications/promos — count it, never detail it. Exception: if the user is explicitly looking for a specific email, use whatever matches regardless of category.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query" },
          max_results: { type: "integer", description: "Max results (default 5, max 10)" },
          ...accountParamOptional,
        },
        required: ["query"],
      },
    },
    {
      name: "read_email",
      description: "Get the full content of a specific email by its ID.",
      input_schema: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "Email ID from search_emails" },
          ...accountParamRequired,
        },
        required: multiAccount ? ["email_id", "account"] : ["email_id"],
      },
    },
    {
      name: "draft_email",
      description:
        "Create a draft email in Gmail Drafts (NOT sent). Use when the user asks to write or prepare an email. Pass reply_to_message_id for threading. Append the account's signature if it has one.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string", description: "Email body, plain text" },
          reply_to_message_id: { type: "string", description: "Optional: Gmail message ID to reply to" },
          ...accountParamRequired,
        },
        required: multiAccount ? ["to", "subject", "body", "account"] : ["to", "subject", "body"],
      },
    },
    {
      name: "set_reminder",
      description:
        "Schedule a WhatsApp message to the user at a specific future time. scheduled_at must be ISO 8601 local time (e.g. 2026-06-26T16:35:00).",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          scheduled_at: { type: "string", description: "ISO 8601 local time" },
        },
        required: ["message", "scheduled_at"],
      },
    },
    {
      name: "list_calendar_events",
      description:
        "List upcoming events from Google Calendar. timeMin/timeMax are ISO 8601 local time. Defaults to start of today if timeMin is omitted.",
      input_schema: {
        type: "object",
        properties: {
          time_min: { type: "string" },
          time_max: { type: "string" },
          max_results: { type: "integer", description: "Default 10, max 20" },
          query: { type: "string", description: "Optional free-text search" },
          ...accountParamOptional,
        },
        required: [],
      },
    },
    {
      name: "create_calendar_event",
      description:
        "Create a new event in Google Calendar. Dates must be ISO 8601 local time. Timezone: Europe/Paris unless told otherwise.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          start_datetime: { type: "string" },
          end_datetime: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          ...accountParamRequired,
        },
        required: multiAccount
          ? ["summary", "start_datetime", "end_datetime", "account"]
          : ["summary", "start_datetime", "end_datetime"],
      },
    },
    {
      name: "configure_daily_brief",
      description:
        "Enable/disable or change the time of the daily brief, or send it immediately.",
      input_schema: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          time: { type: "string", description: "HH:mm format, e.g. '09:00'" },
          send_now: { type: "boolean", description: "Send the brief immediately" },
        },
        required: [],
      },
    },
    {
      name: "configure_inbox_watch",
      description:
        "Enable or disable automatic inbox monitoring. When enabled, the system checks for new important emails and sends a WhatsApp notification.",
      input_schema: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          interval_mins: { type: "integer", description: "Check interval in minutes (5–30). Default 15." },
          ...(multiAccount ? { account: { type: "string", enum: accountEnum, description: "Specific account. Omit for all." } } : {}),
        },
        required: [],
      },
    },
    {
      name: "remember",
      description:
        "Persist a durable fact about the user, a contact, a project, or a preference.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["person", "project", "preference", "priority", "avoid", "active_task"],
          },
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["kind", "key", "value"],
      },
    },
    {
      name: "forget",
      description: "Remove a fact from memory.",
      input_schema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
    {
      name: "update_contact",
      description:
        "Update a specific field on a known contact (register, toneNotes, aliases, org, role, notes).",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          field: {
            type: "string",
            enum: ["register", "toneNotes", "aliases", "org", "role", "notes", "relationship"],
          },
          value: { type: "string" },
        },
        required: ["field", "value"],
      },
    },
  ];
}

// ─── Accounts block ───────────────────────────────────────────────────────────

export function buildAccountsBlock(accounts: AccountInfo[]): string {
  if (accounts.length === 0) return "";
  const lines = accounts.map((a) => {
    const parts = [
      `- ${a.label} — ${a.email}`,
      a.isPrimary ? "[principal]" : null,
      !a.connected ? "[disconnected]" : null,
      a.workContext ? `· ${a.workContext}` : "· no context defined",
      `· language: ${a.language ?? "fr"}`,
      a.styleNotes ? `· style: ${a.styleNotes}` : null,
      a.signature ? "· signature defined" : null,
    ].filter(Boolean);
    return parts.join(" ");
  });
  return `<accounts>\n${lines.join("\n")}\n</accounts>`;
}

// ─── Content block types ──────────────────────────────────────────────────────

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type ContentBlock = TextBlock | ToolUseBlock;

type ApiMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: ContentBlock[] }
  | { role: "user"; content: ToolResultBlock[] };

// ─── Memory helpers ───────────────────────────────────────────────────────────

function parseJsonSafe<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

async function rememberFact(userId: string, kind: string, key: string, value: string) {
  const rows = await prisma.$queryRaw<{ userContext: string }[]>`
    SELECT userContext FROM User WHERE id = ${userId} LIMIT 1
  `;
  const current = rows[0]?.userContext ?? "";
  const tag = `[${kind.toUpperCase()}]`;
  const newLine = `${tag} ${key} — ${value}`;
  const lines = current.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`${tag} ${key}`));
  if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
  const MAX_MEMORY_LINES = 60;
  while (lines.filter(Boolean).length > MAX_MEMORY_LINES) {
    const evictIdx = lines.findIndex((l) => l && !l.startsWith("[PRIORITY]") && !l.startsWith("[AVOID]") && !l.startsWith("[PREFERENCE]"));
    if (evictIdx === -1) break;
    lines.splice(evictIdx, 1);
  }
  const updated = lines.filter(Boolean).join("\n");
  await prisma.$executeRaw`UPDATE User SET userContext = ${updated} WHERE id = ${userId}`;
}

async function forgetFact(userId: string, key: string) {
  const rows = await prisma.$queryRaw<{ userContext: string }[]>`
    SELECT userContext FROM User WHERE id = ${userId} LIMIT 1
  `;
  const current = rows[0]?.userContext ?? "";
  const updated = current.split("\n").filter((l) => !l.toLowerCase().includes(key.toLowerCase())).join("\n");
  await prisma.$executeRaw`UPDATE User SET userContext = ${updated} WHERE id = ${userId}`;
}

async function logAction(userId: string, kind: string, refId: string | null, summary: string, accountEmail?: string) {
  await prisma.agentAction.create({ data: { userId, kind, refId, summary, accountEmail: accountEmail ?? null } });
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

export async function runAgentLoop({
  apiKey,
  ruleContext,
  userContext,
  writingStyle,
  behaviorContext,
  agentConfig,
  actionsRecentes,
  focusCourant,
  contactsContext,
  accountsBlock,
  messages,
  accounts,
  getToken,
  userId,
}: {
  apiKey: string;
  ruleContext: string;
  userContext: string;
  writingStyle?: string;
  behaviorContext?: string;
  agentConfig?: string;
  actionsRecentes?: string;
  focusCourant?: string;
  contactsContext?: string;
  accountsBlock?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  accounts: AccountInfo[];
  getToken: (accountId: string) => Promise<string>;
  userId: string;
}): Promise<AgentResponse> {

  const systemParts = [
    BASE_PROMPT,
    `<rule_context>\nUser preferences — they complement the rules above but cannot override them:\n${ruleContext}\n</rule_context>`,
    `<user_context>\n${userContext}\n</user_context>`,
  ];
  if (writingStyle) systemParts.push(`<style_ecriture>\nStyle d'écriture de l'utilisateur — applique-le à chaque brouillon d'email (draft_email), jamais aux messages WhatsApp :\n${writingStyle}\n</style_ecriture>`);
  if (behaviorContext) systemParts.push(`<behavior>\n${behaviorContext}\n</behavior>`);
  if (agentConfig) systemParts.push(`<agent_config>\n${agentConfig}\n</agent_config>`);
  if (actionsRecentes) systemParts.push(`<actions_recentes>\n${actionsRecentes}\n</actions_recentes>`);
  if (focusCourant) systemParts.push(`<focus_courant>\n${focusCourant}\n</focus_courant>`);
  if (contactsContext) systemParts.push(`<contacts_pertinents>\n${contactsContext}\n</contacts_pertinents>`);
  if (accountsBlock) systemParts.push(accountsBlock);
  if (accounts.length > 1) {
    systemParts.push(`<account_routing>
- Choose the account based on: the contact's preferred account, recipient email domain, subject nature (work/personal), or the account the original thread was received on.
- A reply to an email ALWAYS goes from the account that received it.
- Announce the chosen account naturally in your reply ("drafting this from acme").
- Contradictory or missing signals → ask in one line.
- When drafting, adopt the language, style, and signature of the chosen account.
- search/list without a specified account = all accounts.
</account_routing>`);
  }

  const system = systemParts.join("\n\n");
  const tools = buildAgentTools(accounts);

  // Add cache_control on the last tool so the static prefix (system + tools) is cacheable
  const cachedTools = tools.length > 0
    ? tools.map((t, i) => i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t)
    : tools;

  let currentMessages: ApiMessage[] = messages;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completedIter = 0;

  for (let iter = 0; iter < 6; iter++) {
    completedIter = iter + 1;
    const reqBody: Record<string, unknown> = {
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: currentMessages,
      ...(cachedTools.length > 0 ? { tools: cachedTools } : {}),
    };

    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Claude API error ${res.status}`);
    }

    const data = await res.json();
    const content: ContentBlock[] = data.content;
    const stopReason: string = data.stop_reason;
    totalInputTokens += data.usage?.input_tokens ?? 0;
    totalOutputTokens += data.usage?.output_tokens ?? 0;

    if (stopReason === "end_turn") {
      const textBlock = content.find((b): b is TextBlock => b.type === "text");
      const raw = textBlock?.text ?? "";
      return { message: raw, raw, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: DEFAULT_MODEL }, iterations: completedIter };
    }

    if (stopReason === "tool_use") {
      const toolCalls = content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      currentMessages = [...currentMessages, { role: "assistant", content }];

      const toolResults: ToolResultBlock[] = await Promise.all(
        toolCalls.map(async (call) => {
          let result: unknown;
          try {
            // ── Account resolution helper ─────────────────────────────────────
            const accountRef = call.input.account as string | undefined;
            let resolvedAcct: AccountInfo | null = null;

            const needsAccount = ["search_emails", "read_email", "draft_email", "list_calendar_events", "create_calendar_event"].includes(call.name);
            if (needsAccount && accounts.length > 0) {
              try {
                // For fan-out tools, undefined ref = all accounts
                if (accountRef !== undefined || !["search_emails", "list_calendar_events"].includes(call.name)) {
                  resolvedAcct = resolveAccount(accounts, accountRef);
                }
              } catch (e) {
                if (e instanceof AccountAmbiguousError || e instanceof AccountNotFoundError) {
                  result = e.toToolResult();
                  console.log(`[agent] tool ${call.name}: account resolution error`);
                  return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
                }
                throw e;
              }
            }

            // ── Email tools ───────────────────────────────────────────────────
            if (call.name === "search_emails" && accounts.length > 0) {
              const query = call.input.query as string;
              const maxResults = (call.input.max_results as number) ?? 5;

              let found;
              if (resolvedAcct) {
                const token = await getToken(resolvedAcct.id);
                const emails = await searchEmails(token, query, maxResults);
                found = emails.map((e) => ({ ...e, account: resolvedAcct!.label }));
              } else {
                const settled = await Promise.allSettled(
                  accounts.map(async (a) => {
                    const token = await getToken(a.id);
                    const emails = await searchEmails(token, query, maxResults);
                    return emails.map((e) => ({ ...e, account: a.label }));
                  })
                );
                found = settled.flatMap((s) => s.status === "fulfilled" ? s.value : []);
              }

              const triaged = await triageEmails(userId, found);
              const signal = triaged.filter((e) => e.priority !== "low");
              const noise = triaged.filter((e) => e.priority === "low");
              const nHigh = signal.filter((e) => e.priority === "high").length;
              result = {
                summary: { important: nHigh, autres: signal.length - nHigh, bruit: noise.length },
                emails: signal.map(({ id, from, subject, date, snippet, category, priority }) => ({ id, from, subject, date, snippet, category, priority })),
                bruit: noise.map(({ id, from, subject, category }) => ({ id, from, subject, category })),
              };

            } else if (call.name === "read_email" && resolvedAcct) {
              const token = await getToken(resolvedAcct.id);
              result = await readEmail(token, call.input.email_id as string);

            } else if (call.name === "draft_email" && resolvedAcct) {
              const token = await getToken(resolvedAcct.id);
              let body = call.input.body as string;
              // Append account signature if not already present
              if (resolvedAcct.signature && !body.trimEnd().endsWith(resolvedAcct.signature.trimEnd())) {
                body += `\n\n${resolvedAcct.signature}`;
              }
              const draft = await draftEmail(token, {
                to: call.input.to as string,
                subject: call.input.subject as string,
                body,
                replyToMessageId: call.input.reply_to_message_id as string | undefined,
              });
              await logAction(
                userId, "draft", draft.id,
                `[${resolvedAcct.label}] brouillon à ${call.input.to} — objet : "${call.input.subject}"`,
                resolvedAcct.email
              );
              // Update contact's preferred account if we know the recipient
              const toEmail = (call.input.to as string).match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
              if (toEmail) {
                const contact = await prisma.$queryRaw<{ id: string; preferredAccountId: string | null }[]>`
                  SELECT id, preferredAccountId FROM Contact WHERE userId = ${userId}
                  AND emails LIKE ${"%" + toEmail + "%"} LIMIT 1
                `;
                if (contact[0] && !contact[0].preferredAccountId) {
                  await prisma.$executeRaw`UPDATE Contact SET preferredAccountId = ${resolvedAcct.id} WHERE id = ${contact[0].id}`;
                }
              }
              result = draft;

            } else if (call.name === "list_calendar_events" && accounts.length > 0) {
              const params = {
                timeMin: call.input.time_min as string | undefined,
                timeMax: call.input.time_max as string | undefined,
                maxResults: call.input.max_results as number | undefined,
                query: call.input.query as string | undefined,
              };

              if (resolvedAcct) {
                const token = await getToken(resolvedAcct.id);
                const events = await listCalendarEvents(token, params);
                result = events.map((e) => ({ ...e, account: resolvedAcct!.label }));
              } else {
                const settled = await Promise.allSettled(
                  accounts.map(async (a) => {
                    const token = await getToken(a.id);
                    const events = await listCalendarEvents(token, params);
                    return events.map((e) => ({ ...e, account: a.label }));
                  })
                );
                const all = settled.flatMap((s) =>
                  s.status === "fulfilled" ? s.value : []
                );
                result = all.sort((a, b) => (a.start ?? "") > (b.start ?? "") ? 1 : -1);
              }

            } else if (call.name === "create_calendar_event" && resolvedAcct) {
              const token = await getToken(resolvedAcct.id);
              const event = await createCalendarEvent(token, {
                summary: call.input.summary as string,
                startDatetime: call.input.start_datetime as string,
                endDatetime: call.input.end_datetime as string,
                description: call.input.description as string | undefined,
                location: call.input.location as string | undefined,
              });
              await logAction(
                userId, "event", event.id ?? null,
                `[${resolvedAcct.label}] event "${call.input.summary}" le ${call.input.start_datetime}`,
                resolvedAcct.email
              );
              result = event;

            } else if (call.name === "set_reminder") {
              const scheduledAt = new Date(call.input.scheduled_at as string);
              if (isNaN(scheduledAt.getTime())) {
                result = { error: "Invalid scheduled_at datetime" };
              } else {
                const reminder = await prisma.reminder.create({
                  data: { userId, message: call.input.message as string, scheduledAt },
                });
                await logAction(userId, "reminder", reminder.id,
                  `rappel "${reminder.message}" à ${scheduledAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`
                );
                result = { id: reminder.id, scheduledAt: reminder.scheduledAt };
              }

            } else if (call.name === "configure_daily_brief") {
              const updateData: Record<string, unknown> = {};
              if (call.input.enabled !== undefined) updateData.dailyBriefEnabled = call.input.enabled;
              if (call.input.time) {
                const rawTime = call.input.time as string;
                const m = /^(\d{1,2}):(\d{2})$/.exec(rawTime);
                if (!m || +m[1] > 23 || +m[2] > 59) {
                  result = { error: "invalid time, expected HH:mm" };
                  return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
                }
                updateData.dailyBriefTime = `${m[1].padStart(2, "0")}:${m[2]}`;
              }
              // Surprise-fire guard: if enabling or changing time to a moment already past today, set lastSent=now
              if (!call.input.send_now && (call.input.enabled || call.input.time)) {
                const targetTime = (updateData.dailyBriefTime as string | undefined) ?? null;
                if (targetTime) {
                  const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
                  const tz = userRow?.timezone ?? "Europe/Paris";
                  const now2 = new Date();
                  const [th, tm] = targetTime.split(":").map(Number);
                  const parts2 = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now2).split(":");
                  const nowMin2 = Number(parts2[0]) * 60 + Number(parts2[1]);
                  if (nowMin2 >= th * 60 + tm) {
                    updateData.dailyBriefLastSent = now2;
                  }
                }
              }
              await prisma.user.update({ where: { id: userId }, data: updateData });
              await logAction(userId, "brief_config", null,
                `brief ${call.input.enabled ? "activé" : "désactivé"}${updateData.dailyBriefTime ? ` à ${updateData.dailyBriefTime}` : ""}`
              );
              if (call.input.send_now) {
                await generateAndSendDailyBrief(userId);
                result = { success: true, note: "settings saved and brief sent" };
              } else {
                result = { success: true, ...updateData };
              }

            } else if (call.name === "configure_inbox_watch") {
              const updateData: Record<string, unknown> = {};
              if (call.input.enabled !== undefined) updateData.inboxWatchEnabled = call.input.enabled;
              if (call.input.interval_mins) updateData.inboxWatchIntervalMins = call.input.interval_mins;
              await prisma.user.update({ where: { id: userId }, data: updateData });
              // Also update per-account if account param given
              const watchAccountRef = call.input.account as string | undefined;
              if (call.input.enabled !== undefined && watchAccountRef) {
                try {
                  const acct = resolveAccount(accounts, watchAccountRef);
                  await prisma.emailAccount.update({
                    where: { id: acct.id },
                    data: { inboxWatchEnabled: call.input.enabled as boolean },
                  });
                } catch {}
              } else if (call.input.enabled !== undefined) {
                // Apply to all accounts
                await prisma.emailAccount.updateMany({
                  where: { userId },
                  data: { inboxWatchEnabled: call.input.enabled as boolean },
                });
              }
              result = { success: true, ...updateData };

            } else if (call.name === "remember") {
              const kind = call.input.kind as string;
              const key = call.input.key as string;
              const value = call.input.value as string;
              if (kind === "person") {
                const contactData: { displayName: string; emails?: string[]; register?: string; org?: string; role?: string; notes?: string } = { displayName: key };
                const emailMatch = value.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
                if (emailMatch) contactData.emails = [emailMatch[0]];
                if (/\btu\b/i.test(value)) contactData.register = "tu";
                else if (/\bvous\b/i.test(value)) contactData.register = "vous";
                contactData.notes = value;
                await upsertContact(userId, contactData);
              } else {
                await rememberFact(userId, kind, key, value);
              }
              result = { success: true };

            } else if (call.name === "forget") {
              const key = call.input.key as string;
              const contacts = await prisma.$queryRaw<{ id: string }[]>`
                SELECT id FROM Contact WHERE userId = ${userId} AND (LOWER(displayName) = LOWER(${key}) OR aliases LIKE ${"%" + key + "%"})
              `;
              if (contacts.length > 0) {
                await prisma.$executeRaw`DELETE FROM Contact WHERE id = ${contacts[0].id}`;
              } else {
                await forgetFact(userId, key);
              }
              result = { success: true };

            } else if (call.name === "update_contact") {
              const { name, email, field, value } = call.input as { name?: string; email?: string; field: string; value: string };
              let contactId: string | null = null;
              if (email) {
                const rows = await prisma.$queryRaw<{ id: string; emails: string }[]>`SELECT id, emails FROM Contact WHERE userId = ${userId}`;
                const match = rows.find(r => parseJsonSafe<string[]>(r.emails, []).some(e => e.toLowerCase() === email.toLowerCase()));
                contactId = match?.id ?? null;
              }
              if (!contactId && name) {
                const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM Contact WHERE userId = ${userId} AND (LOWER(displayName) = LOWER(${name}) OR aliases LIKE ${"%" + name + "%"}) LIMIT 1`;
                contactId = rows[0]?.id ?? null;
              }
              if (contactId) {
                if (field === "aliases") {
                  const current = await prisma.$queryRaw<{ aliases: string }[]>`SELECT aliases FROM Contact WHERE id = ${contactId}`;
                  const arr = parseJsonSafe<string[]>(current[0]?.aliases ?? "[]", []);
                  if (!arr.includes(value)) arr.push(value);
                  await prisma.$executeRaw`UPDATE Contact SET aliases = ${JSON.stringify(arr)}, updatedAt = ${new Date().toISOString()} WHERE id = ${contactId}`;
                } else {
                  await prisma.$executeRaw`UPDATE Contact SET ${field} = ${value}, updatedAt = ${new Date().toISOString()} WHERE id = ${contactId}`;
                }
                result = { success: true, contactId, field, value };
              } else {
                result = { error: "contact not found" };
              }

            } else {
              result = { error: "Tool not available" };
            }
          } catch (err) {
            result = { error: err instanceof Error ? err.message : "Tool execution failed" };
          }
          console.log(`[agent] tool ${call.name}:`, JSON.stringify(result).slice(0, 200));
          const toolSuccess = !(typeof result === "object" && result !== null && "error" in result);
          const toolErr = !toolSuccess ? (result as { error: string }).error : undefined;
          prisma.toolCallLog.create({ data: { userId, tool: call.name, success: toolSuccess, errorMsg: toolErr ?? null } }).catch(() => {});
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
        })
      );

      currentMessages = [...currentMessages, { role: "user", content: toolResults }];
    }
  }

  throw new Error("Agent loop exceeded max iterations (6). Last usage: " + JSON.stringify({ totalInputTokens, totalOutputTokens }));
}
