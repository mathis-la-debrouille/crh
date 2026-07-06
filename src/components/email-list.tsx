"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailItem, PaginatedEmails } from "@/types/api";

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
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pageStack, setPageStack] = useState<string[]>([]);

  async function fetchPage(pageToken?: string) {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const url = pageToken
        ? `/api/gmail/emails?pageToken=${encodeURIComponent(pageToken)}`
        : "/api/gmail/emails";
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load emails");
      const { emails: newEmails, nextPageToken: next } = data as PaginatedEmails;
      setEmails(newEmails);
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
          {loading ? "Loading..." : "View Recent Emails"}
        </Button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

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
            <Button variant="ghost" size="sm" onClick={loadFirst}>
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
