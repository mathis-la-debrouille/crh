"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarEvent, PaginatedEvents } from "@/types/api";

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
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pageStack, setPageStack] = useState<string[]>([]);

  async function fetchPage(pageToken?: string) {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const url = pageToken
        ? `/api/calendar/events?pageToken=${encodeURIComponent(pageToken)}`
        : "/api/calendar/events";
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load events");
      const { events: newEvents, nextPageToken: next } = data as PaginatedEvents;
      setEvents(newEvents);
      setNextPageToken(next);
      setLoaded(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Request timed out. The Google token may need to be refreshed — try signing out and back in.");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPage(); }, []);

  function loadFirst() {
    setPageStack([]);
    fetchPage();
  }

  function loadNext() {
    if (!nextPageToken) return;
    setPageStack((s) => [...s, nextPageToken]);
    fetchPage(nextPageToken);
  }

  function loadPrev() {
    const stack = [...pageStack];
    stack.pop();
    const token = stack[stack.length - 1];
    setPageStack(stack);
    fetchPage(token);
  }

  return (
    <div className="space-y-3">
      {!loaded && (
        <Button variant="outline" size="sm" onClick={loadFirst} disabled={loading}>
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
              {events.length} event{events.length !== 1 ? "s" : ""} · next 90 days
            </p>
            <Button variant="ghost" size="sm" onClick={loadFirst}>
              Refresh
            </Button>
          </div>

          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {events.map((evt) => (
              <div key={evt.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#0f172a]">{evt.summary}</p>
                  <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {durationLabel(evt.start, evt.end)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{formatEventDate(evt.start)}</p>
                {evt.location && (
                  <p className="mt-0.5 text-xs text-slate-400">{evt.location}</p>
                )}
                {evt.attendees.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {evt.attendees.slice(0, 3).join(", ")}
                    {evt.attendees.length > 3 && ` +${evt.attendees.length - 3} more`}
                  </p>
                )}
              </div>
            ))}
            {events.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                No upcoming events
              </p>
            )}
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={loadPrev}
              disabled={pageStack.length === 0}
            >
              ← Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadNext}
              disabled={!nextPageToken}
            >
              Next →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
