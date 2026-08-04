// Single dispatch point: every call site that touches email/calendar picks the
// right backend (Gmail/Google Calendar vs Microsoft Graph) based on the
// EmailAccount's `provider` field. Callers never import gmail-tools.ts,
// calendar-tools.ts, or graph-tools.ts directly — they import from here instead,
// so the agent tool layer (claude.ts) and the tool definitions/system prompt
// never need to know which provider they're talking to.
import * as gmail from "@/lib/gmail-tools";
import * as gcal from "@/lib/calendar-tools";
import * as graph from "@/lib/graph-tools";
import type { EmailSummary, EmailFull, DraftResult } from "@/lib/gmail-tools";
import type { CalendarEventItem, CreatedEvent, CalendarRef } from "@/lib/calendar-tools";

export type Provider = "google" | "microsoft";

function isMicrosoft(provider: string): boolean {
  return provider === "microsoft";
}

export async function searchEmails(
  provider: string,
  accessToken: string,
  query: string,
  maxResults = 5
): Promise<EmailSummary[]> {
  return isMicrosoft(provider)
    ? graph.searchEmails(accessToken, query, maxResults)
    : gmail.searchEmails(accessToken, query, maxResults);
}

export async function readEmail(provider: string, accessToken: string, emailId: string): Promise<EmailFull> {
  return isMicrosoft(provider) ? graph.readEmail(accessToken, emailId) : gmail.readEmail(accessToken, emailId);
}

export async function draftEmail(
  provider: string,
  accessToken: string,
  params: { to: string; subject: string; body: string; replyToMessageId?: string }
): Promise<DraftResult> {
  return isMicrosoft(provider) ? graph.draftEmail(accessToken, params) : gmail.draftEmail(accessToken, params);
}

// Microsoft: single default calendar only (see graph-tools.ts). Google: fans out
// across every non-freeBusy calendar the account has. Callers should skip fetching
// `calendars` for microsoft accounts (getCalendarIds already returns [] for them).
export async function listCalendarEvents(
  provider: string,
  accessToken: string,
  params: { timeMin?: string; timeMax?: string; maxResults?: number; query?: string; tz?: string },
  calendars?: CalendarRef[]
): Promise<CalendarEventItem[]> {
  if (isMicrosoft(provider)) return graph.listCalendarEvents(accessToken, params);
  return gcal.listCalendarEvents(accessToken, { ...params, calendars });
}

export async function createCalendarEvent(
  provider: string,
  accessToken: string,
  params: {
    summary: string;
    startDatetime: string;
    endDatetime: string;
    description?: string;
    location?: string;
    timezone?: string;
  }
): Promise<CreatedEvent> {
  return isMicrosoft(provider) ? graph.createCalendarEvent(accessToken, params) : gcal.createCalendarEvent(accessToken, params);
}

// Multi-calendar discovery — Google only for now; Microsoft accounts get a
// single implicit "default calendar" (see listCalendarEvents above).
export async function getCalendarIds(provider: string, accessToken: string, accountId: string): Promise<CalendarRef[]> {
  if (isMicrosoft(provider)) return [];
  return gcal.getCalendarIds(accessToken, accountId);
}
