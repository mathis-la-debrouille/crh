export interface CalendarEventItem {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees: string[];
  calendar?: string; // calendar summary; undefined when it's the primary calendar
}

function tzOffset(date: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(date).find((x) => x.type === "timeZoneName")!.value; // "GMT+2"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(p);
  if (!m) return "Z";
  return `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
}

export function localToRFC3339(s: string, tz: string): string {
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(s)) return s;
  const base = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s;
  return base + tzOffset(new Date(base), tz);
}

function defaultStartOfTodayLocal(tz: string): string {
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return `${localDate}T00:00:00`;
}

// ─── Multi-calendar discovery ──────────────────────────────────────────────

export interface CalendarRef {
  id: string;
  summary: string;
  primary: boolean;
}

const calListCache = new Map<string, { ids: CalendarRef[]; at: number }>();
const CAL_LIST_TTL_MS = 30 * 60 * 1000;

export async function getCalendarIds(accessToken: string, userId: string): Promise<CalendarRef[]> {
  const cached = calListCache.get(userId);
  if (cached && Date.now() - cached.at < CAL_LIST_TTL_MS) return cached.ids;

  try {
    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`calendarList failed: ${res.status}`);
    const data = await res.json();
    const items = (data.items ?? []) as Record<string, unknown>[];
    const filtered: CalendarRef[] = items
      .filter((c) => c.selected !== false && c.accessRole !== "freeBusyReader")
      .map((c) => ({
        id: c.id as string,
        summary: (c.summaryOverride as string) ?? (c.summary as string) ?? (c.id as string),
        primary: !!c.primary,
      }));
    const ids = filtered.length > 0 ? filtered : [{ id: "primary", summary: "primary", primary: true }];
    calListCache.set(userId, { ids, at: Date.now() });
    return ids;
  } catch (err) {
    console.error("[calendar] getCalendarIds error:", err instanceof Error ? err.message : err);
    return [{ id: "primary", summary: "primary", primary: true }];
  }
}

// ─── Event listing ──────────────────────────────────────────────────────────

async function fetchEventsForOneCalendar(
  accessToken: string,
  calendarId: string,
  calendarSummary: string | undefined,
  {
    timeMin, timeMax, maxResults, query, tz,
  }: { timeMin?: string; timeMax?: string; maxResults: number; query?: string; tz: string }
): Promise<CalendarEventItem[]> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));

  url.searchParams.set("timeMin", localToRFC3339(timeMin ?? defaultStartOfTodayLocal(tz), tz));
  if (timeMax) url.searchParams.set("timeMax", localToRFC3339(timeMax, tz));
  if (query) url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message ?? `Calendar list failed: ${res.status}`;
    console.error(`[calendar] list error (${calendarId}):`, JSON.stringify(err));
    throw new Error(msg);
  }

  const data = await res.json();
  return (data.items ?? []).map((evt: Record<string, unknown>) => {
    const start = evt.start as Record<string, string> | undefined;
    const end = evt.end as Record<string, string> | undefined;
    const attendees = (evt.attendees as { email?: string }[] | undefined) ?? [];
    return {
      id: evt.id as string,
      summary: (evt.summary as string) ?? "(No title)",
      start: start?.dateTime ?? start?.date ?? "",
      end: end?.dateTime ?? end?.date ?? "",
      location: evt.location as string | undefined,
      description: evt.description as string | undefined,
      attendees: attendees.map((a) => a.email ?? "").filter(Boolean),
      calendar: calendarSummary,
    };
  });
}

export async function listCalendarEvents(
  accessToken: string,
  {
    timeMin,
    timeMax,
    maxResults = 10,
    query,
    tz = "Europe/Paris",
    calendars,
  }: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    query?: string;
    tz?: string;
    calendars?: CalendarRef[];
  }
): Promise<CalendarEventItem[]> {
  const cappedMax = Math.min(maxResults, 20);
  const cals = calendars && calendars.length > 0 ? calendars : [{ id: "primary", summary: "primary", primary: true }];

  const settled = await Promise.allSettled(
    cals.map((c) =>
      fetchEventsForOneCalendar(accessToken, c.id, c.primary ? undefined : c.summary, {
        timeMin, timeMax, maxResults: cappedMax, query, tz,
      })
    )
  );

  const merged = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  merged.sort((a, b) => (a.start ?? "") > (b.start ?? "") ? 1 : -1);
  return merged.slice(0, cappedMax);
}

// ─── Event creation (always primary — unchanged) ────────────────────────────

export interface CreatedEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
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
    summary,
    start: { dateTime: localToRFC3339(startDatetime, timezone), timeZone: timezone },
    end: { dateTime: localToRFC3339(endDatetime, timezone), timeZone: timezone },
  };
  if (description) body.description = description;
  if (location) body.location = location;

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Calendar create failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    summary: data.summary,
    start: data.start?.dateTime ?? data.start?.date,
    end: data.end?.dateTime ?? data.end?.date,
    htmlLink: data.htmlLink,
  };
}
