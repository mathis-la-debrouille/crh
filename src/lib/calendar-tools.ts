export interface CalendarEventItem {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees: string[];
}

function toRFC3339(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T00:00:00Z";
  return s + "Z";
}

export async function listCalendarEvents(
  accessToken: string,
  {
    timeMin,
    timeMax,
    maxResults = 10,
    query,
  }: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    query?: string;
  }
): Promise<CalendarEventItem[]> {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(Math.min(maxResults, 20)));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  url.searchParams.set("timeMin", toRFC3339(timeMin) ?? startOfToday.toISOString());
  if (timeMax) url.searchParams.set("timeMax", toRFC3339(timeMax)!);
  if (query) url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message ?? `Calendar list failed: ${res.status}`;
    console.error("[calendar] list error:", JSON.stringify(err));
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
    };
  });
}

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
    start: { dateTime: toRFC3339(startDatetime) ?? startDatetime, timeZone: timezone },
    end: { dateTime: toRFC3339(endDatetime) ?? endDatetime, timeZone: timezone },
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
