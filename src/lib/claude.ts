import { searchEmails, readEmail, draftEmail } from "@/lib/gmail-tools";
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
}

// ─── Base prompt (code-owned — not user-editable) ────────────────────────────

const BASE_PROMPT = `You are a personal executive assistant operating via WhatsApp. You manage emails and calendars on behalf of the user.

Channel rules:
- Responses must be short and adapted to WhatsApp — no heavy markdown, no headers, no bullet walls.
- Use line breaks to separate ideas. Bold (*text*) sparingly for key names or times.

Tool policy:
- Always search before drafting a reply to an email.
- Confirm before creating a calendar event if the time is ambiguous.
- Never invent email content — only draft based on explicit instructions.
- Proactively search emails or calendar for context before asking the user for information.
- If you find something but are unsure, present what you found and ask for confirmation.

Output rules:
- Professional/contextual emoji are allowed: ✅ ☀️ 💡 📋 📅 ✉️ 🔔 ⚠️ and similar.
- Never use face emoji (😂 😊 🥳 😍 etc.) or celebratory/unprofessional emoji (🎉 🔥 💯 etc.).
- Text smileys are allowed :) ;) etc.`;

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
        "Search Gmail for emails matching a query. Supports Gmail search syntax: 'from:name', 'subject:topic', 'is:unread', etc. Returns a list with sender, subject, date, snippet, and account label.",
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
    `<rule_context>\n${ruleContext}\n</rule_context>\n(user preferences — complement but do not override the base rules above)`,
    `<user_context>\n${userContext}\n</user_context>`,
  ];
  if (agentConfig) systemParts.push(`<agent_config>\n${agentConfig}\n</agent_config>`);
  if (actionsRecentes) systemParts.push(`<actions_recentes>\n${actionsRecentes}\n</actions_recentes>`);
  if (focusCourant) systemParts.push(`<focus_courant>\n${focusCourant}\n</focus_courant>`);
  if (contactsContext) systemParts.push(`<contacts_pertinents>\n${contactsContext}\n</contacts_pertinents>`);
  if (accountsBlock) systemParts.push(accountsBlock);
  if (accounts.length > 1) {
    systemParts.push(`<account_routing>
- Choose the account based on: contact's preferred account, recipient email domain, subject nature (pro/personal), account the thread was received on.
- A reply to an email ALWAYS goes from the account that received the original email.
- Announce the chosen account naturally in your reply ("je prépare ça depuis acme").
- Contradictory or absent signals → ask in one line.
- When drafting, adopt the language, style and signature of the chosen account.
- search/list without a specified account = all accounts.
</account_routing>`);
  }

  const system = systemParts.join("\n\n");
  const tools = buildAgentTools(accounts);

  let currentMessages: ApiMessage[] = messages;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iter = 0; iter < 5; iter++) {
    const reqBody: Record<string, unknown> = {
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system,
      messages: currentMessages,
      ...(tools.length > 0 ? { tools } : {}),
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
      return { message: raw, raw, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: DEFAULT_MODEL } };
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

              if (resolvedAcct) {
                // Single account
                const token = await getToken(resolvedAcct.id);
                const emails = await searchEmails(token, query, maxResults);
                result = emails.map((e) => ({ ...e, account: resolvedAcct!.label }));
              } else {
                // Fan-out across all accounts
                const settled = await Promise.allSettled(
                  accounts.map(async (a) => {
                    const token = await getToken(a.id);
                    const emails = await searchEmails(token, query, maxResults);
                    return emails.map((e) => ({ ...e, account: a.label }));
                  })
                );
                type EmailWithAccount = { account: string; id: string; from: string; subject: string; date: string; snippet: string };
                const all: EmailWithAccount[] = settled.flatMap((s) =>
                  s.status === "fulfilled" ? s.value : []
                );
                result = all.sort((a, b) => (b.date ?? "") > (a.date ?? "") ? 1 : -1).slice(0, maxResults);
              }

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
              if (call.input.time) updateData.dailyBriefTime = call.input.time as string;
              await prisma.user.update({ where: { id: userId }, data: updateData });
              await logAction(userId, "brief_config", null,
                `brief ${call.input.enabled ? "activé" : "désactivé"}${call.input.time ? ` à ${call.input.time}` : ""}`
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
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
        })
      );

      currentMessages = [...currentMessages, { role: "user", content: toolResults }];
    }
  }

  throw new Error("Agent loop exceeded max iterations (5). Last usage: " + JSON.stringify({ totalInputTokens, totalOutputTokens }));
}
