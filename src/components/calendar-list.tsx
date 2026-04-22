"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarEvent } from "@/types/api";

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationLabel(start: string, end: string): string {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const mins = Math.round((e - s) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function CalendarList() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/events");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to load events");
      }
      const data: CalendarEvent[] = await res.json();
      setEvents(data);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {!loaded && (
        <Button
          variant="outline"
          size="sm"
          onClick={loadEvents}
          disabled={loading}
        >
          {loading ? "Loading..." : "View Upcoming Events"}
        </Button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {loaded && !loading && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {events.length} event{events.length !== 1 ? "s" : ""} this week
            </p>
            <Button variant="ghost" size="sm" onClick={loadEvents}>
              Refresh
            </Button>
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {events.map((evt) => (
              <div key={evt.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#0f172a]">
                    {evt.summary}
                  </p>
                  <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {durationLabel(evt.start, evt.end)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatEventDate(evt.start)}
                </p>
                {evt.location && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {evt.location}
                  </p>
                )}
                {evt.attendees.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {evt.attendees.slice(0, 3).join(", ")}
                    {evt.attendees.length > 3 &&
                      ` +${evt.attendees.length - 3} more`}
                  </p>
                )}
              </div>
            ))}
            {events.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                No upcoming events this week
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
