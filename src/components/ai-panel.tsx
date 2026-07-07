"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function AiPanel() {
  const [ruleContext, setRuleContext] = useState("");
  const [userContext, setUserContext] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [savingUser, setSavingUser] = useState(false);

  const [briefEnabled, setBriefEnabled] = useState(false);
  const [briefTime, setBriefTime] = useState("09:00");
  const [savingBrief, setSavingBrief] = useState(false);
  const [sendingBrief, setSendingBrief] = useState(false);

  useEffect(() => {
    fetch("/api/ai/config")
      .then((r) => r.json())
      .then((data) => {
        setRuleContext(data.ruleContext ?? "");
        setUserContext(data.userContext ?? "");
      })
      .catch(() => {});
    fetch("/api/user/daily-brief")
      .then((r) => r.json())
      .then((data) => {
        setBriefEnabled(!!data.dailyBriefEnabled);
        if (data.dailyBriefTime) setBriefTime(data.dailyBriefTime);
      })
      .catch(() => {});
  }, []);

  async function saveDailyBrief() {
    setSavingBrief(true);
    try {
      await fetch("/api/user/daily-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: briefEnabled, time: briefTime }),
      });
    } finally {
      setSavingBrief(false);
    }
  }

  async function sendBriefNow() {
    setSendingBrief(true);
    try {
      await fetch("/api/user/daily-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendNow: true }),
      });
    } finally {
      setSendingBrief(false);
    }
  }

  async function saveContext(field: "ruleContext" | "userContext", value: string) {
    const setSaving = field === "ruleContext" ? setSavingRule : setSavingUser;
    setSaving(true);
    try {
      await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Daily Brief */}
      <div className="space-y-2 rounded-md border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Daily Brief</p>
            <p className="text-xs text-slate-400">
              Morning WhatsApp with your agenda, inbox highlights, and a daily summary.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={briefEnabled}
              onChange={(e) => setBriefEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-slate-600">{briefEnabled ? "On" : "Off"}</span>
          </label>
        </div>
        {briefEnabled && (
          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm text-slate-600">Send at</span>
            <input
              type="time"
              value={briefTime}
              onChange={(e) => setBriefTime(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            />
            <span className="text-xs text-slate-400">in your timezone</span>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={saveDailyBrief} disabled={savingBrief}>
            {savingBrief ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={sendBriefNow} disabled={sendingBrief}>
            {sendingBrief ? "Sending…" : "Send now"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Rule context */}
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-slate-700">Rule Context</p>
            <p className="text-xs text-slate-400">
              Global agent behaviour — what it can do, how to respond, tone, limits.
            </p>
          </div>
          <textarea
            value={ruleContext}
            onChange={(e) => setRuleContext(e.target.value)}
            rows={12}
            placeholder={`You are an AI executive assistant for a CEO.\n\nYou can:\n- Read and summarise emails\n- Check the calendar\n- Draft replies in the user's writing style\n- Send WhatsApp messages\n\nAlways be concise. Prioritise urgent items. Never send emails without explicit approval.`}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none font-mono"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveContext("ruleContext", ruleContext)}
            disabled={savingRule}
          >
            {savingRule ? "Saving…" : "Save Rules"}
          </Button>
        </div>

        {/* User context */}
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-slate-700">User Context</p>
            <p className="text-xs text-slate-400">
              What the agent knows about the user — role, projects, contacts, writing style.
            </p>
          </div>
          <textarea
            value={userContext}
            onChange={(e) => setUserContext(e.target.value)}
            rows={12}
            placeholder={`Name: [Name]\nRole: CEO at [Company]\nTimezone: Europe/Paris\n\nKey contacts:\n- [Name] (CTO) — technical decisions\n- [Name] (EA) — scheduling\n\nOngoing projects:\n- …\n\nWriting style:\n- Direct, short sentences\n- No filler words\n- Formal with external contacts, casual internally`}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none font-mono"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveContext("userContext", userContext)}
            disabled={savingUser}
          >
            {savingUser ? "Saving…" : "Save Profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}
