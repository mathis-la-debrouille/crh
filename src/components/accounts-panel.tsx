"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Account {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  connected: boolean;
  displayName: string | null;
  signature: string | null;
  language: string | null;
  styleNotes: string | null;
  workContext: string | null;
  inboxWatchEnabled: boolean;
}

export function AccountsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const params = useSearchParams();

  useEffect(() => {
    fetch("/api/accounts").then(r => r.json()).then(setAccounts);
  }, []);

  useEffect(() => {
    const connected = params.get("account_connected");
    const error = params.get("account_error");
    if (connected) { showToast(`${connected} connected`); fetch("/api/accounts").then(r => r.json()).then(setAccounts); }
    if (error) showToast(`Error: ${error}`, true);
  }, [params]);

  function showToast(msg: string, isErr = false) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
    void isErr;
  }

  async function save(id: string, data: Partial<Account>) {
    setSaving(id);
    await fetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...data }) });
    const updated = await fetch("/api/accounts").then(r => r.json());
    setAccounts(updated);
    setSaving(null);
    showToast("Saved");
  }

  async function makePrimary(id: string) {
    await save(id, { isPrimary: true });
  }

  async function disconnect(id: string, email: string) {
    if (!confirm(`Disconnect ${email}?`)) return;
    await fetch("/api/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const updated = await fetch("/api/accounts").then(r => r.json());
    setAccounts(updated);
    showToast("Disconnected");
  }

  return (
    <div className="space-y-3">
      {toast && (
        <div className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">{toast}</div>
      )}

      {accounts.map((a) => (
        <div key={a.id} className="rounded-lg border border-slate-200">
          {/* Row */}
          <button
            onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${a.connected ? "bg-green-400" : "bg-slate-300"}`} />
            <span className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[#0f172a]">{a.label}</span>
              <span className="ml-2 text-xs text-slate-400">{a.email}</span>
            </span>
            {a.isPrimary && (
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-px text-xs font-medium text-blue-600">primary</span>
            )}
            {!a.connected && (
              <span className="shrink-0 rounded-full bg-red-50 px-2 py-px text-xs font-medium text-red-500">disconnected</span>
            )}
            <span className="text-slate-300 text-xs">{expanded === a.id ? "▲" : "▼"}</span>
          </button>

          {/* Expanded editor */}
          {expanded === a.id && (
            <div className="border-t border-slate-100 px-4 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Label</label>
                  <Input
                    defaultValue={a.label}
                    placeholder="perso"
                    onBlur={(e) => e.target.value !== a.label && save(a.id, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Display name</label>
                  <Input
                    defaultValue={a.displayName ?? ""}
                    placeholder="Mathis Laurent"
                    onBlur={(e) => save(a.id, { displayName: e.target.value || null })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Work context</label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-[#0f172a] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  rows={2}
                  defaultValue={a.workContext ?? ""}
                  placeholder="CTO @ Acme — B2B SaaS, team of 12"
                  onBlur={(e) => save(a.id, { workContext: e.target.value || null })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Language</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-[#0f172a]"
                    defaultValue={a.language ?? "fr"}
                    onChange={(e) => save(a.id, { language: e.target.value })}
                  >
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Style notes</label>
                  <Input
                    defaultValue={a.styleNotes ?? ""}
                    placeholder="concis, tutoiement"
                    onBlur={(e) => save(a.id, { styleNotes: e.target.value || null })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Signature</label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-[#0f172a] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono"
                  rows={3}
                  defaultValue={a.signature ?? ""}
                  placeholder={"Mathis\nCTO, Acme"}
                  onBlur={(e) => save(a.id, { signature: e.target.value || null })}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked={a.inboxWatchEnabled}
                    onChange={(e) => save(a.id, { inboxWatchEnabled: e.target.checked })}
                  />
                  Inbox watch
                </label>

                <div className="flex items-center gap-2">
                  {saving === a.id && <span className="text-xs text-slate-400">Saving…</span>}
                  {!a.isPrimary && (
                    <Button variant="outline" size="sm" onClick={() => makePrimary(a.id)}>
                      Make primary
                    </Button>
                  )}
                  {!a.isPrimary && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => disconnect(a.id, a.email)}
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => window.location.href = "/api/accounts/connect"}
      >
        + Add Google account
      </Button>
    </div>
  );
}
