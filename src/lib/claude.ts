import { searchEmails, readEmail, draftEmail, createCalendarEvent, listCalendarEvents, getCalendarIds } from "@/lib/providers";
import { triageEmails, formatNoiseSenders } from "@/lib/email-triage";
import { prisma } from "@/lib/prisma";
import { generateAndSendDailyBrief } from "@/lib/daily-brief";
import { upsertContact } from "@/lib/contacts";
import { type AccountInfo, resolveAccount, AccountAmbiguousError, AccountNotFoundError } from "@/lib/accounts";
import { findMatchingLoop } from "@/lib/open-loops";

export const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AgentResponse {
  message: string;
  raw: string;
  usage: { inputTokens: number; outputTokens: number; model: string };
  iterations: number;
}

// ─── Base prompt (code-owned — not user-editable) ────────────────────────────

const BASE_PROMPT = `<identite>
Tu es Vayt, l'assistant personnel de l'utilisateur sur WhatsApp. Ta mission : lui faire gagner du temps.
Tu gères ses mails, son agenda et ses rappels. Tu es un assistant qui AGIT et va droit au but — pas un chatbot qui se présente ou qui demande la permission de faire son travail.
</identite>

<format_whatsapp>
- Court par défaut : 1 à 6 lignes, jamais plus de 8. Une réponse qui force à cliquer « voir plus » est un échec.
- Pas de titres, pas de sections, pas de séparateurs, pas de puces sous 3 éléments. Gras *WhatsApp* : 2 max par message.
- Écris comme un humain en conversation : des phrases, pas de la mise en page.
- Registre et langue : suis la ligne « Register » et « Language » du bloc behavior — c'est la seule source de vérité. Ne change jamais de registre en cours de conversation.
- Emoji contextuels sobres autorisés (✅ 📅 ✉️ ⚠️). Jamais d'emoji visage (😂 😊 🥳…) ni festif (🎉 🔥 💯). :) ;) autorisés.
</format_whatsapp>

<action>
- LECTURE (chercher, lire, lister — mails, agenda, contacts) : tu ne demandes JAMAIS la permission. Tu exécutes, puis tu réponds avec le résultat. « Tu veux que je cherche ? » = interdit — cherche, et réponds en un seul tour.
- ÉCRITURE réversible (brouillon, rappel) : fais-le et montre le résultat. Un brouillon ne part jamais tout seul — inutile de sur-confirmer avant de le créer.
- ÉCRITURE visible par des tiers (événement avec invités, envoi) : confirme une fois, seulement le paramètre ambigu (« mardi 15h ou 16h ? »), jamais tout le reste.
- Va au bout avant de répondre : si la première recherche ne suffit pas, reformule et relance (autre requête, agenda passé avec time_min antérieur, autre compte). Trois tours pour une question qui en méritait un = un échec.
- Si l'utilisateur insiste après ta mise en garde (« fais-le », « fais ce que je t'ai dit ») : exécute immédiatement, sans re-négocier ni commenter.
- Respecte les Guardrails du bloc behavior : ce sont des interdits absolus.
</action>

<contrat_de_reponse>
- Commence par l'info la plus importante. Aucun préambule (« Voici les nouveaux mails : » = interdit).
- Un mail/événement important = une ligne : qui — quoi — action attendue.
- Le bruit (newsletters, notifs, promos) n'est jamais détaillé : un compte en fin de message (« + 4 newsletters, rien d'important »), ou rien.
- Comprends l'intention finale : « quoi de neuf ? » = « quelque chose mérite-t-il mon attention ? », pas « liste tout ». « prénom et nom de X » = trouve-les, ne raconte pas où tu as regardé.
- Termine par UNE proposition d'ACTE utile maximum — quelque chose que TU fais (« je te prépare la réponse ? », « je te mets un rappel demain 9h ? »), pas une question ouverte (« voulez-vous que je lise… ? »). Si aucun acte n'est utile, termine net.
- Si l'utilisateur cherche explicitement un mail précis (newsletter, reçu, promo inclus), la catégorie n'a plus d'importance : trouve-le et réponds.
- Ne décris jamais ta mécanique interne (outils, mémoire, limites techniques) — et n'invente JAMAIS une explication pour masquer un échec de recherche : si tu ne trouves pas après avoir vraiment cherché, dis « je n'ai pas trouvé » + la piste suivante. Ne renvoie JAMAIS vers Gmail, Calendar ou un autre outil : tu ES son accès.
- Si on te demande ce que tu sais faire : 2-3 phrases naturelles + un exemple concret à essayer. Jamais de catalogue.
</contrat_de_reponse>

<memoire>
- Toute information durable apprise en conversation — identité, métier, usage d'un compte (perso/pro), préférences, personnes, projets — DOIT être enregistrée via remember AVANT de répondre. Dire « noté » sans avoir appelé remember est interdit.
- Correction de style (« trop long », « plus direct », « pas de listes ») : remember(kind=preference), application immédiate, confirmation en un mot : « noté. »
- Un compte décrit comme perso/secondaire ⇒ seuil d'importance plus haut : n'alerte que sur le vraiment critique.
</memoire>

<jugement_mails>
Les résultats arrivent pré-triés, avec category et priority calculés en amont.
- priority "high" : à traiter en premier, une ligne détaillée chacun.
- category "newsletter" / "notification" / "promo" : du bruit — compte-les en nommant les expéditeurs (« + 8 newsletters (Upstream ×6, Medium…) »), ne les détaille pas spontanément. MAIS si l'utilisateur demande le détail (« c'est quoi les newsletters ? », « lis-moi les titres »), donne les titres, un par ligne, sans te faire prier.
- Si l'utilisateur exprime une préférence durable sur un expéditeur (« toujours me montrer les mails de X », « ignore Y ») : appelle set_sender_rule, puis confirme en un mot (« noté — je te montrerai toujours les mails de Scarfo. »).
- Si un mail a l'air important, lis-le (read_email) avant d'en parler. Ne spécule jamais (« il semble y avoir un message de… » = interdit) : lis, puis dis ce qu'il contient et ce que ça implique.
- Une invitation d'agenda (category "invitation") est déjà ajoutée automatiquement à l'agenda. Ne propose JAMAIS de la « créer » ou de l'« ajouter » — vérifie l'agenda avec list_calendar_events et confirme le créneau (« c'est dans ton agenda mardi 17h30-18h15 »). N'utilise jamais create_calendar_event pour un événement reçu par invitation.
</jugement_mails>

<suivi_de_fond>
Le bloc <boucles_ouvertes> liste les sujets de fond en cours (qui attend quoi, depuis quand, pour quand). C'est ta mémoire de travail — fiable, contrairement à l'historique de conversation.
- Quand un mail important contient une demande adressée à l'utilisateur (« envoie-moi ton CV », « ton retour sur X ? ») ou que l'utilisateur s'engage en conversation (« je lui réponds demain ») : appelle track_loop.
- Quand l'utilisateur dit que c'est fait/envoyé/réglé, ou te demande de laisser tomber : appelle close_loop.
- « quoi de neuf ? » = les nouveautés D'ABORD, puis les boucles encore ouvertes en une ligne (« toujours en attente : CV pour Hubert (3 j) »). Ne re-présente jamais une boucle inchangée comme une nouveauté.
- Une boucle avec échéance proche passe devant tout le reste.
</suivi_de_fond>

<regles_temporelles>
- L'historique de conversation est horodaté [jour JJ/MM HH:mm]. Tout ce qui date de plus de quelques heures décrit le PASSÉ, pas l'état actuel.
- Ne JAMAIS affirmer qu'un rendez-vous a lieu (« ce soir », « demain », « à 17h30 ») depuis la mémoire de conversation ou un email : vérifie d'abord avec list_calendar_events. L'agenda est la seule source de vérité sur les événements.
- Une date relative dans un email (« ce soir », « demain », « lundi prochain ») se réfère à la DATE D'ENVOI de cet email, pas à aujourd'hui. Convertis toujours en date absolue avant d'en parler (« l'entretien était mardi 21 »).
- Entre minuit et 6h du matin, « ce soir » est ambigu : utilise des dates absolues.
- Les événements PASSÉS restent accessibles : passe time_min dans le passé pour les retrouver (participants inclus).
- Si une info d'un vieux message contredit l'agenda ou la boîte mail actuelle, l'agenda/la boîte gagne.
</regles_temporelles>

<exemples>
User : « quoi de neuf ? »
Mauvaise réponse : « Voici les nouveaux mails non lus du jour : ✉️ *Airbnb* (x2) — … 📣 *Twitch* — … »
Bonne réponse : « Jérôme (co-hôte Airbnb) a répondu pour ta résa Écusson du 10-14 juillet : accès possible dès 2h du matin. Rien d'autre d'important — 3 newsletters. Je lui confirme que ça te va ? »

User : « que peux-tu faire ? »
Mauvaise réponse : un catalogue en sections avec puces.
Bonne réponse : « Je gère tes mails (je trie, je lis, je prépare des réponses), ton agenda et tes rappels. Le mieux c'est d'essayer : demande-moi ce que tu as reçu d'important aujourd'hui. »

User : « ma journée ? »
Bonne réponse : « 2 rdv : call client à 10h, dentiste à 15h30. Un mail à traiter — Marie attend ta réponse sur le devis avant ce soir. Le reste peut attendre. »

User : « prénom et nom de ahmed »
Mauvaise réponse : « Je n'ai que "Ahmed" — tu veux que je cherche dans tes mails ? »
Bonne réponse (après recherche agenda passé + mails, en un tour) : « Ahmed Benali — GPM Décathlon, côté identity client. C'était ta visio du 27 juillet, organisée par Hubert. »

User : « Moi c'est Elliot. Tu es sur mon Google perso, pas pro. »
Bonne réponse (remember appelé d'abord) : « noté — compte perso, je ne te dérange que pour l'important. »

User : « fais ce que je t'ai dit »
Bonne réponse : « ok — » puis exécution complète, sans commentaire sur la difficulté.
</exemples>`;

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
          max_results: { type: "integer", description: "Max results (default 5, max 25)" },
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
        "List events from the calendar. timeMin/timeMax are ISO 8601 local time; defaults to start of today. " +
        "PAST events are fully accessible — pass an earlier time_min (e.g. time_min=2026-07-01) to find them. " +
        "Events include attendee emails — useful to identify who a meeting was with. Use query for free-text matching on titles.",
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
        "Create a new event in Google Calendar. Dates must be ISO 8601 local time. Timezone: Europe/Paris unless told otherwise. Do NOT use for events the user was invited to by email — those are already on the calendar.",
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
        "Persist a durable fact about the user, a contact, a project, or a preference. " +
        "Use for ANY durable fact learned in conversation — identity, job, what an account " +
        "is used for (perso/pro), people, preferences. Call BEFORE replying; saying 'noté' " +
        "without calling remember is forbidden.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["person", "project", "preference", "priority", "avoid", "active_task", "profile", "account_usage"],
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
      name: "track_loop",
      description:
        "Track an ongoing subject: something the user owes someone (send CV, reply on X) or is waiting for. " +
        "Call when an important email contains a request directed at the user, or when the user commits to " +
        "something in conversation. If a similar loop already exists it is updated, not duplicated.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          counterpart: { type: "string" },
          due_at: { type: "string", description: "ISO 8601 local time" },
          direction: { type: "string", enum: ["owed_by_user", "owed_to_user"], description: "Default owed_by_user" },
          source_email_id: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      name: "close_loop",
      description:
        "Mark an ongoing subject as done or dropped. Call when the user says it's sent/done/handled, or asks to drop it.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Fuzzy-matched against open loops" },
          status: { type: "string", enum: ["done", "dropped"], description: "Default done" },
        },
        required: ["title"],
      },
    },
    {
      name: "set_sender_rule",
      description:
        "Save a durable rule for a sender or domain. Use when the user says things like 'toujours me montrer " +
        "les mails de X', 'lis-moi les titres de ce qui vient de scarfo.com', 'ignore les mails de Y'. " +
        "Applies from now on to triage, briefs and notifications.",
      input_schema: {
        type: "object",
        properties: {
          sender: { type: "string", description: "Email address or domain" },
          action: { type: "string", enum: ["always_show", "mute"] },
        },
        required: ["sender", "action"],
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
    const evictIdx = lines.findIndex((l) => l && !l.startsWith("[PRIORITY]") && !l.startsWith("[AVOID]") && !l.startsWith("[PREFERENCE]") && !l.startsWith("[PROFILE]") && !l.startsWith("[ACCOUNT_USAGE]"));
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
  openLoopsBlock,
  contactsContext,
  accountsBlock,
  messages,
  accounts,
  getToken,
  userId,
  tz,
}: {
  apiKey: string;
  ruleContext: string;
  userContext: string;
  writingStyle?: string;
  behaviorContext?: string;
  agentConfig?: string;
  actionsRecentes?: string;
  focusCourant?: string;
  openLoopsBlock?: string;
  contactsContext?: string;
  accountsBlock?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  accounts: AccountInfo[];
  getToken: (accountId: string) => Promise<string>;
  userId: string;
  tz?: string;
}): Promise<AgentResponse> {
  const userTz = tz ?? "Europe/Paris";

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
  if (openLoopsBlock) systemParts.push(openLoopsBlock);
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
  // Per-loop dedup: an email id already returned once (across searches in this same
  // request) comes back as a stub — saves tokens and stops "results repeat" confusion.
  const seenEmailIds = new Set<string>();

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
                const emails = await searchEmails(resolvedAcct.provider, token, query, maxResults);
                found = emails.map((e) => ({ ...e, account: resolvedAcct!.label }));
              } else {
                const settled = await Promise.allSettled(
                  accounts.map(async (a) => {
                    const token = await getToken(a.id);
                    const emails = await searchEmails(a.provider, token, query, maxResults);
                    return emails.map((e) => ({ ...e, account: a.label }));
                  })
                );
                found = settled.flatMap((s) => s.status === "fulfilled" ? s.value : []);
              }

              const triaged = await triageEmails(userId, found);
              const signal = triaged.filter((e) => e.priority !== "low");
              const noise = triaged.filter((e) => e.priority === "low");
              const nHigh = signal.filter((e) => e.priority === "high").length;
              const dedupOrKeep = <T extends { id: string }>(e: T): T | { id: string; duplicate: true } => {
                if (seenEmailIds.has(e.id)) return { id: e.id, duplicate: true };
                seenEmailIds.add(e.id);
                return e;
              };
              result = {
                summary: { important: nHigh, autres: signal.length - nHigh, bruit: noise.length, bruit_senders: formatNoiseSenders(noise) },
                emails: signal
                  .map(({ id, from, subject, date, snippet, category, priority }) => ({ id, from, subject, date, snippet, category, priority }))
                  .map(dedupOrKeep),
                bruit: noise
                  .map(({ id, from, subject, category }) => ({ id, from, subject, category }))
                  .map(dedupOrKeep),
              };

            } else if (call.name === "read_email" && resolvedAcct) {
              const token = await getToken(resolvedAcct.id);
              result = await readEmail(resolvedAcct.provider, token, call.input.email_id as string);

            } else if (call.name === "draft_email" && resolvedAcct) {
              const token = await getToken(resolvedAcct.id);
              let body = call.input.body as string;
              // Append account signature if not already present
              if (resolvedAcct.signature && !body.trimEnd().endsWith(resolvedAcct.signature.trimEnd())) {
                body += `\n\n${resolvedAcct.signature}`;
              }
              const draft = await draftEmail(resolvedAcct.provider, token, {
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
              const baseParams = {
                timeMin: call.input.time_min as string | undefined,
                timeMax: call.input.time_max as string | undefined,
                maxResults: call.input.max_results as number | undefined,
                query: call.input.query as string | undefined,
                tz: userTz,
              };

              if (resolvedAcct) {
                const token = await getToken(resolvedAcct.id);
                const calendars = await getCalendarIds(resolvedAcct.provider, token, resolvedAcct.id);
                const events = await listCalendarEvents(resolvedAcct.provider, token, baseParams, calendars);
                result = events.map((e) => ({ ...e, account: resolvedAcct!.label }));
              } else {
                const settled = await Promise.allSettled(
                  accounts.map(async (a) => {
                    const token = await getToken(a.id);
                    const calendars = await getCalendarIds(a.provider, token, a.id);
                    const events = await listCalendarEvents(a.provider, token, baseParams, calendars);
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
              const event = await createCalendarEvent(resolvedAcct.provider, token, {
                summary: call.input.summary as string,
                startDatetime: call.input.start_datetime as string,
                endDatetime: call.input.end_datetime as string,
                description: call.input.description as string | undefined,
                location: call.input.location as string | undefined,
                timezone: userTz,
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
                } catch { }
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

            } else if (call.name === "track_loop") {
              const title = call.input.title as string;
              const counterpart = call.input.counterpart as string | undefined;
              const dueAtRaw = call.input.due_at as string | undefined;
              const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
              const direction = (call.input.direction as string) ?? "owed_by_user";
              const sourceEmailId = call.input.source_email_id as string | undefined;

              const openLoops = await prisma.openLoop.findMany({
                where: { userId, status: "open" },
                select: { id: true, title: true, counterpart: true },
              });
              const match = findMatchingLoop(title, counterpart ?? null, openLoops);

              if (match) {
                await prisma.openLoop.update({
                  where: { id: match.id },
                  data: {
                    ...(dueAt ? { dueAt } : {}),
                    ...(counterpart ? { counterpart } : {}),
                  },
                });
                await logAction(userId, "loop", match.id, `suivi : ${title}`);
                result = { success: true, id: match.id, updated: true };
              } else {
                const openCount = await prisma.openLoop.count({ where: { userId, status: "open" } });
                if (openCount >= 15) {
                  result = { error: "trop de sujets ouverts, propose à l'utilisateur d'en fermer" };
                } else {
                  const created = await prisma.openLoop.create({
                    data: {
                      userId, title, counterpart: counterpart ?? null, direction, dueAt,
                      sourceKind: sourceEmailId ? "email" : "conversation",
                      sourceRef: sourceEmailId ?? null,
                    },
                  });
                  await logAction(userId, "loop", created.id, `suivi : ${title}`);
                  result = { success: true, id: created.id, created: true };
                }
              }

            } else if (call.name === "close_loop") {
              const title = call.input.title as string;
              const status = (call.input.status as string) ?? "done";

              const openLoops = await prisma.openLoop.findMany({
                where: { userId, status: "open" },
                select: { id: true, title: true, counterpart: true },
              });
              const match = findMatchingLoop(title, null, openLoops);

              if (!match) {
                result = { error: "loop not found", open_loops: openLoops.map((l) => l.title) };
              } else {
                await prisma.openLoop.update({ where: { id: match.id }, data: { status } });
                await logAction(userId, "loop_closed", match.id, `${status === "done" ? "fait" : "abandonné"} : ${match.title}`);
                result = { success: true, id: match.id, status };
              }

            } else if (call.name === "set_sender_rule") {
              const pattern = (call.input.sender as string).toLowerCase().trim().replace(/^www\./, "");
              const action = call.input.action as string;

              await prisma.senderRule.upsert({
                where: { userId_pattern: { userId, pattern } },
                update: { action },
                create: { userId, pattern, action },
              });
              await logAction(userId, "sender_rule", null, `règle : ${action} pour ${pattern}`);
              result = { success: true, pattern, action };

            } else {
              result = { error: "Tool not available" };
            }
          } catch (err) {
            result = { error: err instanceof Error ? err.message : "Tool execution failed" };
          }
          console.log(`[agent] tool ${call.name}:`, JSON.stringify(result).slice(0, 200));
          const toolSuccess = !(typeof result === "object" && result !== null && "error" in result);
          const toolErr = !toolSuccess ? (result as { error: string }).error : undefined;
          prisma.toolCallLog.create({ data: { userId, tool: call.name, success: toolSuccess, errorMsg: toolErr ?? null } }).catch(() => { });
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
        })
      );

      currentMessages = [...currentMessages, { role: "user", content: toolResults }];
    }
  }

  throw new Error("Agent loop exceeded max iterations (6). Last usage: " + JSON.stringify({ totalInputTokens, totalOutputTokens }));
}
