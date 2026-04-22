import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import type { CalendarEvent } from "@/types/api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.googleConnected) {
    return NextResponse.json(
      { error: "Google account not connected" },
      { status: 403 }
    );
  }

  try {
    const calendar = await getCalendarClient(session.userId);

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: sevenDaysLater.toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events: CalendarEvent[] = (res.data.items ?? []).map((evt) => ({
      id: evt.id ?? "",
      summary: evt.summary ?? "(No title)",
      start: evt.start?.dateTime ?? evt.start?.date ?? "",
      end: evt.end?.dateTime ?? evt.end?.date ?? "",
      location: evt.location ?? "",
      attendees: (evt.attendees ?? [])
        .map((a) => a.email ?? "")
        .filter(Boolean),
    }));

    return NextResponse.json(events);
  } catch (error) {
    console.error("Calendar API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar events" },
      { status: 500 }
    );
  }
}
