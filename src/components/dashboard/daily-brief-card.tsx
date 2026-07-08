"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TIMEZONES = [
  "Europe/Paris", "Europe/London", "Europe/Berlin", "Europe/Madrid",
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Singapore", "Asia/Dubai", "Australia/Sydney",
];

interface Props {
  initialEnabled: boolean;
  initialTime: string | null;
  initialTimezone: string;
  initialLastSent: Date | null;
}

export function DailyBriefCard({ initialEnabled, initialTime, initialTimezone, initialLastSent }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [time, setTime] = useState(initialTime ?? "08:00");
  const [timezone, setTimezone] = useState(initialTimezone);
  const [lastSent] = useState<Date | null>(initialLastSent);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await fetch("/api/user/daily-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, time, timezone }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function sendNow() {
    setSending(true);
    await fetch("/api/user/daily-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendNow: true }),
    });
    setSending(false);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Daily brief</CardTitle>
          <label className="flex cursor-pointer items-center gap-2">
            <span className="text-xs text-slate-500">{enabled ? "On" : "Off"}</span>
            <button
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                enabled ? "bg-blue-600" : "bg-slate-200"
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabled && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Send at</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz.replace("_", " ")}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Contains: today&apos;s calendar, priority emails, active reminders.
            </p>
          </div>
        )}

        {lastSent && (
          <p className="text-xs text-slate-400">
            Last sent: {new Date(lastSent).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={saving} className="bg-[#2563eb] hover:bg-blue-700 text-white">
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </Button>
          {enabled && (
            <Button size="sm" variant="outline" onClick={sendNow} disabled={sending}>
              {sending ? "Sending…" : "Send preview now"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
