"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailItem } from "@/types/api";

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function EmailList() {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEmails() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/emails");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to load emails");
      }
      const data: EmailItem[] = await res.json();
      setEmails(data);
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
          onClick={loadEmails}
          disabled={loading}
        >
          {loading ? "Loading..." : "View Recent Emails"}
        </Button>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
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
            <p className="text-sm text-slate-500">{emails.length} emails</p>
            <Button variant="ghost" size="sm" onClick={loadEmails}>
              Refresh
            </Button>
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {emails.map((email) => (
              <div key={email.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#0f172a] truncate">
                    {email.from}
                  </p>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatRelativeDate(email.date)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-semibold text-slate-700 truncate">
                  {email.subject || "(No subject)"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                  {email.snippet}
                </p>
              </div>
            ))}
            {emails.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                No emails found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
