export interface EmailItem {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
}

export interface PaginatedEmails {
  emails: EmailItem[];
  nextPageToken: string | null;
}

export interface PaginatedEvents {
  events: CalendarEvent[];
  nextPageToken: string | null;
}

export interface AiConfig {
  claudeApiKey: string | null;
  ruleContext: string;
  userContext: string;
}
