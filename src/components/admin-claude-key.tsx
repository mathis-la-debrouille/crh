"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminClaudeKeyProps {
  initialConnected: boolean;
}

export function AdminClaudeKey({ initialConnected }: AdminClaudeKeyProps) {
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(initialConnected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/claude-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claudeApiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setConnected(true);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Claude API Key</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${connected ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
          {connected ? "Connected" : "Not set"}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={connected ? "sk-ant-••••••••  (enter new key to replace)" : "sk-ant-api03-…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="max-w-sm font-mono text-sm"
        />
        <Button
          size="sm"
          onClick={save}
          disabled={saving || !apiKey.trim()}
          className="bg-[#2563eb] hover:bg-blue-700"
        >
          {saving ? "Saving…" : connected ? "Replace" : "Set key"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">
        Shared system key — used for all users. Stored encrypted in the database.
      </p>
    </div>
  );
}
