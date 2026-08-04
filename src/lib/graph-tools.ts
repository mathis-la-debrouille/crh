// Microsoft Graph adapter — mirrors gmail-tools.ts + calendar-tools.ts function
// signatures and return shapes exactly, so the agent layer (claude.ts) never has
// to know which provider it's talking to. See src/lib/providers.ts for the dispatch.
import type { EmailSummary, EmailFull, DraftResult } from "@/lib/gmail-tools";
import type { CalendarEventItem, CreatedEvent } from "@/lib/calendar-tools";
import { localToRFC3339 } from "@/lib/calendar-tools";

const GRAPH_API = "https://graph.microsoft.com/v1.0";

// ─── Query translation (best-effort Gmail-syntax → Graph $search/$filter) ────
// Graph doesn't speak Gmail search syntax. We translate the handful of operators
// this codebase actually emits (in:inbox, in:sent, is:unread, newer_than:Nd,
// after:<unix>, -from:me, from:x, subject:x) and pass the remainder as $search,
// which Graph itself understands as a KQL-ish free-text query.
function buildGraphSearchParams(rawQuery: string): { search?: string; filter?: string; folder: string } {
  let q = rawQuery;
  let folder = "me/messages";
  const filters: string[] = [];

  if (/\bin:inbox\b/i.test(q)) { folder = "me/mailFolders/inbox/messages"; q = q.replace(/\bin:inbox\b/gi, ""); }
  else if (/\bin:sent\b/i.test(q)) { folder = "me/mailFolders/sentitems/messages"; q = q.replace(/\bin:sent\b/gi, ""); }

  if (/\bis:unread\b/i.test(q)) { filters.push("isRead eq false"); q = q.replace(/\bis:unread\b/gi, ""); }

  const newerMatch = /\bnewer_than:(\d+)d\b/i.exec(q);
  if (newerMatch) {
    const since = new Date(Date.now() - Number(newerMatch[1]) * 86400000).toISOString();
    filters.push(`receivedDateTime ge ${since}`);
    q = q.replace(newerMatch[0], "");
  }

  const afterMatch = /\bafter:(\d+)\b/i.exec(q);
  if (afterMatch) {
    const since = new Date(Number(afterMatch[1]) * 1000).toISOString();
    filters.push(`receivedDateTime ge ${since}`);
    q = q.replace(afterMatch[0], "");
  }

  q = q.replace(/-from:me/gi, "").trim();

  return {
    search: q ? q : undefined,
    filter: filters.length > 0 ? filters.join(" and ") : undefined,
    folder,
  };
}

function formatAddress(addr: { emailAddress?: { name?: string; address?: string } } | undefined): string {
  if (!addr?.emailAddress) return "";
  const { name, address } = addr.emailAddress;
  return name && address ? `"${name}" <${address}>` : (address ?? "");
}

function extractHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

const MESSAGE_SELECT = "id,from,subject,receivedDateTime,bodyPreview,isRead,importance,internetMessageHeaders";

function toEmailSummary(m: Record<string, unknown>): EmailSummary {
  const headers = m.internetMessageHeaders as { name: string; value: string }[] | undefined;
  const listUnsub = extractHeader(headers, "List-Unsubscribe");
  const precedence = extractHeader(headers, "Precedence");
  const labelIds: string[] = [];
  if (m.importance === "high") labelIds.push("IMPORTANT");

  return {
    id: m.id as string,
    from: formatAddress(m.from as { emailAddress?: { name?: string; address?: string } }),
    subject: (m.subject as string) ?? "",
    date: (m.receivedDateTime as string) ?? "",
    snippet: (m.bodyPreview as string) ?? "",
    labelIds,
    listUnsubscribe: listUnsub.length > 0,
    precedenceBulk: /bulk|list|junk/i.test(precedence),
  };
}

export async function searchEmails(
  accessToken: string,
  query: string,
  maxResults = 5
): Promise<EmailSummary[]> {
  const { search, filter, folder } = buildGraphSearchParams(query);
  const url = new URL(`${GRAPH_API}/${folder}`);
  url.searchParams.set("$top", String(Math.min(maxResults, 25)));
  url.searchParams.set("$select", MESSAGE_SELECT);
  if (search) url.searchParams.set("$search", `"${search.replace(/"/g, "")}"`);
  if (filter) url.searchParams.set("$filter", filter);
  if (!search) url.searchParams.set("$orderby", "receivedDateTime desc");

  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (search) headers.ConsistencyLevel = "eventual";

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Graph mail search failed: ${res.status}`);
  }

  const data = await res.json();
  const items: Record<string, unknown>[] = data.value ?? [];
  return items.map(toEmailSummary);
}

export async function readEmail(accessToken: string, emailId: string): Promise<EmailFull> {
  const url = `${GRAPH_API}/me/messages/${emailId}?$select=${MESSAGE_SELECT},toRecipients,body`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Graph mail read failed: ${res.status}`);
  }

  const data = await res.json();
  const summary = toEmailSummary(data);
  const toRecipients = (data.toRecipients as { emailAddress?: { name?: string; address?: string } }[] | undefined) ?? [];

  return {
    ...summary,
    to: toRecipients.map((r) => formatAddress(r as { emailAddress?: { name?: string; address?: string } })).join(", "),
    body: ((data.body as { content?: string })?.content ?? "").slice(0, 8000),
  };
}

export async function draftEmail(
  accessToken: string,
  {
    to,
    subject,
    body,
    replyToMessageId,
  }: { to: string; subject: string; body: string; replyToMessageId?: string }
): Promise<DraftResult> {
  const toRecipients = to.split(",").map((addr) => ({ emailAddress: { address: addr.trim() } }));
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  let draftId: string;
  let threadId: string | undefined;

  if (replyToMessageId) {
    const replyRes = await fetch(`${GRAPH_API}/me/messages/${replyToMessageId}/createReply`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (!replyRes.ok) {
      const err = await replyRes.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Graph createReply failed: ${replyRes.status}`);
    }
    const draft = await replyRes.json();
    draftId = draft.id;
    threadId = draft.conversationId;

    const patchRes = await fetch(`${GRAPH_API}/me/messages/${draftId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ subject, body: { contentType: "text", content: body }, toRecipients }),
    });
    if (!patchRes.ok) {
      const err = await patchRes.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Graph draft patch failed: ${patchRes.status}`);
    }
  } else {
    const res = await fetch(`${GRAPH_API}/me/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subject, body: { contentType: "text", content: body }, toRecipients }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Graph draft creation failed: ${res.status}`);
    }
    const data = await res.json();
    draftId = data.id;
    threadId = data.conversationId;
  }

  return { id: draftId, threadId };
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
// v1 scope: the user's default calendar only (no secondary-calendar fan-out —
// Graph's /me/calendarView already merges the default calendar's recurring
// instances; multi-calendar would need /me/calendars + per-calendar calendarView,
// left out for now since it wasn't in the requested signature).

function defaultStartOfTodayLocal(tz: string): string {
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return `${localDate}T00:00:00`;
}

function addDaysLocal(localDateTime: string, days: number): string {
  const d = new Date(localDateTime);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19);
}

function stripOffset(s: string): string {
  return s.replace(/(Z|[+-]\d{2}:\d{2})$/, "");
}

export async function listCalendarEvents(
  accessToken: string,
  {
    timeMin,
    timeMax,
    maxResults = 10,
    query,
    tz = "Europe/Paris",
  }: { timeMin?: string; timeMax?: string; maxResults?: number; query?: string; tz?: string }
): Promise<CalendarEventItem[]> {
  const cappedMax = Math.min(maxResults, 20);
  const start = timeMin ? stripOffset(timeMin) : defaultStartOfTodayLocal(tz);
  const end = timeMax ? stripOffset(timeMax) : addDaysLocal(start, 30);

  const url = new URL(`${GRAPH_API}/me/calendarView`);
  url.searchParams.set("startDateTime", start);
  url.searchParams.set("endDateTime", end);
  url.searchParams.set("$top", String(cappedMax));
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set("$select", "id,subject,start,end,location,bodyPreview,attendees");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${tz}"`,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Graph calendar list failed: ${res.status}`);
  }

  const data = await res.json();
  const items: Record<string, unknown>[] = data.value ?? [];

  let events: CalendarEventItem[] = items.map((evt) => {
    const start = evt.start as { dateTime?: string } | undefined;
    const end = evt.end as { dateTime?: string } | undefined;
    const attendees = (evt.attendees as { emailAddress?: { address?: string } }[] | undefined) ?? [];
    return {
      id: evt.id as string,
      summary: (evt.subject as string) || "(No title)",
      // Graph returns naive local wall-clock time (via Prefer: outlook.timezone) — add
      // the real offset so downstream consumers don't misread it as server-local/UTC.
      start: start?.dateTime ? localToRFC3339(start.dateTime, tz) : "",
      end: end?.dateTime ? localToRFC3339(end.dateTime, tz) : "",
      location: (evt.location as { displayName?: string } | undefined)?.displayName,
      description: evt.bodyPreview as string | undefined,
      attendees: attendees.map((a) => a.emailAddress?.address ?? "").filter(Boolean),
    };
  });

  if (query) {
    const q = query.toLowerCase();
    events = events.filter((e) => e.summary.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q));
  }

  return events.slice(0, cappedMax);
}

export async function createCalendarEvent(
  accessToken: string,
  {
    summary,
    startDatetime,
    endDatetime,
    description,
    location,
    timezone = "Europe/Paris",
  }: {
    summary: string;
    startDatetime: string;
    endDatetime: string;
    description?: string;
    location?: string;
    timezone?: string;
  }
): Promise<CreatedEvent> {
  const body: Record<string, unknown> = {
    subject: summary,
    start: { dateTime: stripOffset(startDatetime), timeZone: timezone },
    end: { dateTime: stripOffset(endDatetime), timeZone: timezone },
  };
  if (description) body.body = { contentType: "text", content: description };
  if (location) body.location = { displayName: location };

  const res = await fetch(`${GRAPH_API}/me/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Graph calendar create failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    summary: data.subject,
    start: localToRFC3339(stripOffset(data.start?.dateTime ?? startDatetime), timezone),
    end: localToRFC3339(stripOffset(data.end?.dateTime ?? endDatetime), timezone),
    htmlLink: data.webLink,
  };
}
