import { searchEmails, readEmail, draftEmail } from "@/lib/gmail-tools";
import { createCalendarEvent, listCalendarEvents } from "@/lib/calendar-tools";
import { prisma } from "@/lib/prisma";
import { generateAndSendDailyBrief } from "@/lib/daily-brief";
import { upsertContact } from "@/lib/contacts";

export const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AgentResponse {
  message: string;
  raw: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const AGENT_TOOLS = [
  {
    name: "search_emails",
    description:
      "Search Gmail for emails matching a query. Supports Gmail search syntax: 'from:name', 'subject:topic', 'is:unread', etc. Returns a list with sender, subject, date, and snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "integer", description: "Max results (default 5, max 10)" },
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
      },
      required: ["email_id"],
    },
  },
  {
    name: "draft_email",
    description:
      "Create a draft email in Gmail Drafts (NOT sent). Use when the user asks to write or prepare an email. Pass reply_to_message_id for threading.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body, plain text" },
        reply_to_message_id: { type: "string", description: "Optional: Gmail message ID to reply to" },
      },
      required: ["to", "subject", "body"],
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
      },
      required: ["summary", "start_datetime", "end_datetime"],
    },
  },
  {
    name: "configure_daily_brief",
    description:
      "Enable/disable or change the time of the daily brief, or send it immediately. Call when user configures the brief.",
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
      "Enable or disable automatic inbox monitoring. When enabled, the system checks for new important emails at the configured interval and sends a WhatsApp notification if something arrives.",
    input_schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        interval_mins: {
          type: "integer",
          description: "How often to check in minutes (5, 10, 15, 30). Default 15.",
        },
      },
      required: [],
    },
  },
  {
    name: "remember",
    description:
      "Persist a durable fact about the user, a contact, a project, or a preference. Call only when new persistent information appears in the conversation.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["person", "project", "preference", "priority", "avoid", "active_task"],
          description: "Category of the fact",
        },
        key: { type: "string", description: "Short identifier, e.g. 'Jeanne' or 'email_style'" },
        value: { type: "string", description: "The fact to remember" },
      },
      required: ["kind", "key", "value"],
    },
  },
  {
    name: "forget",
    description:
      "Remove a fact from memory. Use when the user says to forget or stop mentioning something.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The key to remove" },
      },
      required: ["key"],
    },
  },
  {
    name: "update_contact",
    description:
      "Update a specific field on a known contact (register, toneNotes, aliases, org, role, notes). Use when the user explicitly corrects or adds info about a contact (e.g. 'avec lui c'est tu', 'il s'appelle Juan').",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name or alias of the contact to update" },
        email: { type: "string", description: "Email address to look up the contact (preferred if known)" },
        field: {
          type: "string",
          enum: ["register", "toneNotes", "aliases", "org", "role", "notes", "relationship"],
          description: "Field to update",
        },
        value: { type: "string", description: "New value for the field" },
      },
      required: ["field", "value"],
    },
  },
];

// ─── Content block types ─────────────────────────────────────────────────────

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type ContentBlock = TextBlock | ToolUseBlock;

type ApiMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: ContentBlock[] }
  | { role: "user"; content: ToolResultBlock[] };

// ─── Memory helpers ──────────────────────────────────────────────────────────

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
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  const updated = lines.filter(Boolean).join("\n");
  await prisma.$executeRaw`UPDATE User SET userContext = ${updated} WHERE id = ${userId}`;
}

async function forgetFact(userId: string, key: string) {
  const rows = await prisma.$queryRaw<{ userContext: string }[]>`
    SELECT userContext FROM User WHERE id = ${userId} LIMIT 1
  `;
  const current = rows[0]?.userContext ?? "";
  const updated = current
    .split("\n")
    .filter((l) => !l.toLowerCase().includes(key.toLowerCase()))
    .join("\n");
  await prisma.$executeRaw`UPDATE User SET userContext = ${updated} WHERE id = ${userId}`;
}

async function logAction(userId: string, kind: string, refId: string | null, summary: string) {
  await prisma.agentAction.create({ data: { userId, kind, refId, summary } });
}

// ─── Agentic loop ────────────────────────────────────────────────────────────

export async function runAgentLoop({
  apiKey,
  ruleContext,
  userContext,
  agentConfig,
  actionsRecentes,
  focusCourant,
  contactsContext,
  messages,
  accessToken,
  userId,
}: {
  apiKey: string;
  ruleContext: string;
  userContext: string;
  agentConfig?: string;
  actionsRecentes?: string;
  focusCourant?: string;
  contactsContext?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  accessToken: string | null;
  userId: string;
}): Promise<AgentResponse> {
  const systemParts = [
    `<output_rules>\n- Professional/contextual emoji are allowed: ✅ ☀️ 💡 📋 📅 ✉️ 🔔 ⚠️ and similar.\n- Never use face emoji (😂 😊 🥳 😍 🤣 etc.) or celebratory/unprofessional emoji (🎉 🎊 🔥 💯 etc.).\n- Text smileys are allowed :) ;) etc.\n</output_rules>`,
    `<rule_context>\n${ruleContext}\n</rule_context>`,
    `<user_context>\n${userContext}\n</user_context>`,
  ];
  if (agentConfig) systemParts.push(`<agent_config>\n${agentConfig}\n</agent_config>`);
  if (actionsRecentes) systemParts.push(`<actions_recentes>\n${actionsRecentes}\n</actions_recentes>`);
  if (focusCourant) systemParts.push(`<focus_courant>\n${focusCourant}\n</focus_courant>`);
  if (contactsContext) systemParts.push(`<contacts_pertinents>\n${contactsContext}\n</contacts_pertinents>`);
  const system = systemParts.join("\n\n");

  // Tools always available: remember, forget, configure_daily_brief, set_reminder
  // Email/calendar tools only when Google is connected
  const alwaysAvailable = ["remember", "forget", "update_contact", "configure_daily_brief", "configure_inbox_watch", "set_reminder"];
  const tools = accessToken
    ? AGENT_TOOLS
    : AGENT_TOOLS.filter((t) => alwaysAvailable.includes(t.name));

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
            if (call.name === "search_emails" && accessToken) {
              result = await searchEmails(
                accessToken,
                call.input.query as string,
                (call.input.max_results as number) ?? 5
              );
            } else if (call.name === "read_email" && accessToken) {
              result = await readEmail(accessToken, call.input.email_id as string);
            } else if (call.name === "draft_email" && accessToken) {
              const draft = await draftEmail(accessToken, {
                to: call.input.to as string,
                subject: call.input.subject as string,
                body: call.input.body as string,
                replyToMessageId: call.input.reply_to_message_id as string | undefined,
              });
              await logAction(
                userId,
                "draft",
                draft.id,
                `brouillon à ${call.input.to} — objet : "${call.input.subject}"`
              );
              result = draft;
            } else if (call.name === "set_reminder") {
              const scheduledAt = new Date(call.input.scheduled_at as string);
              if (isNaN(scheduledAt.getTime())) {
                result = { error: "Invalid scheduled_at datetime" };
              } else {
                const reminder = await prisma.reminder.create({
                  data: { userId, message: call.input.message as string, scheduledAt },
                });
                await logAction(
                  userId,
                  "reminder",
                  reminder.id,
                  `rappel "${reminder.message}" à ${scheduledAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`
                );
                result = { id: reminder.id, scheduledAt: reminder.scheduledAt };
              }
            } else if (call.name === "list_calendar_events" && accessToken) {
              result = await listCalendarEvents(accessToken, {
                timeMin: call.input.time_min as string | undefined,
                timeMax: call.input.time_max as string | undefined,
                maxResults: call.input.max_results as number | undefined,
                query: call.input.query as string | undefined,
              });
            } else if (call.name === "create_calendar_event" && accessToken) {
              const event = await createCalendarEvent(accessToken, {
                summary: call.input.summary as string,
                startDatetime: call.input.start_datetime as string,
                endDatetime: call.input.end_datetime as string,
                description: call.input.description as string | undefined,
                location: call.input.location as string | undefined,
              });
              await logAction(
                userId,
                "event",
                event.id ?? null,
                `event "${call.input.summary}" le ${call.input.start_datetime}`
              );
              result = event;
            } else if (call.name === "configure_daily_brief") {
              const updateData: Record<string, unknown> = {};
              if (call.input.enabled !== undefined) updateData.dailyBriefEnabled = call.input.enabled;
              if (call.input.time) updateData.dailyBriefTime = call.input.time as string;
              await prisma.user.update({ where: { id: userId }, data: updateData });
              await logAction(
                userId,
                "brief_config",
                null,
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
              result = { success: true, ...updateData };
              console.log("[agent] inbox watch configured:", updateData);
            } else if (call.name === "remember") {
              const kind = call.input.kind as string;
              const key = call.input.key as string;
              const value = call.input.value as string;
              if (kind === "person") {
                // Route to Contact table — parse "name | email | register | org" style values
                const contactData: { displayName: string; emails?: string[]; register?: string; org?: string; role?: string; notes?: string; aliases?: string[] } = { displayName: key };
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
              // Try to delete contact first, then fall back to userContext line
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
              // Find contact by email or name
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
