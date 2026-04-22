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
