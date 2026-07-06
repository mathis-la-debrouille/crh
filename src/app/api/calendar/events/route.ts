import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/google";
import type { PaginatedEvents, CalendarEvent } from "@/types/api";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  console.log("[calendar] 1 - route entered");

  const session = await getServerSession(authOptions);
  console.log("[calendar] 2 - session:", session?.userId);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageToken = req.nextUrl.searchParams.get("pageToken") ?? undefined;

  try {
    console.log("[calendar] 3 - getting access token");
    const accessToken = await getValidAccessToken(session.userId);
    console.log("[calendar] 4 - got token, listing events");

    const now = new Date();
    const ninetyDaysLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", now.toISOString());
    url.searchParams.set("timeMax", ninetyDaysLater.toISOString());
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err?.error?.message ?? `Calendar failed: ${res.status}`);
    }

    const data = await res.json();
    const events: CalendarEvent[] = (data.items ?? []).map((evt: Record<string, unknown>) => {
      const start = evt.start as Record<string, string> | undefined;
      const end = evt.end as Record<string, string> | undefined;
      const attendees = (evt.attendees as { email?: string }[] | undefined) ?? [];
      return {
        id: (evt.id as string) ?? "",
        summary: (evt.summary as string) ?? "(No title)",
        start: start?.dateTime ?? start?.date ?? "",
        end: end?.dateTime ?? end?.date ?? "",
        location: (evt.location as string) ?? "",
        attendees: attendees.map((a) => a.email ?? "").filter(Boolean),
      };
    });

    console.log(`[calendar] 5 - returning ${events.length} events`);
    const result: PaginatedEvents = { events, nextPageToken: data.nextPageToken ?? null };
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendar] ERROR:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
