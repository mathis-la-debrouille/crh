"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AccountData() {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function disconnect(type: "google" | "whatsapp") {
    if (!confirm(`Disconnect ${type === "google" ? "Google" : "WhatsApp"}? You can reconnect later.`)) return;
    setDisconnecting(type);
    await fetch("/api/user/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    setDisconnecting(null);
    window.location.reload();
  }

  async function deleteAccount() {
    const confirmed = confirm(
      "This will permanently delete your account and all your data. This cannot be undone.\n\nType OK to confirm."
    );
    if (!confirmed) return;
    setDeleting(true);
    await fetch("/api/user/delete", { method: "DELETE" });
    await signOut({ redirect: false });
    window.location.href = "/";
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Account & data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Phase 2 reserved */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Contacts & memory", desc: "Your relationship memory — names, preferences, notes on contacts." },
            { label: "Reminders", desc: "View and cancel scheduled reminders." },
          ].map(({ label, desc }) => (
            <div key={label} className="rounded-lg border border-dashed border-slate-200 p-4 opacity-50">
              <p className="text-sm font-medium text-slate-600">{label}</p>
              <p className="mt-1 text-xs text-slate-400">{desc}</p>
              <p className="mt-2 text-xs text-slate-300 italic">Coming soon</p>
            </div>
          ))}
        </div>

        {/* Privacy controls */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Connections</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnect("google")}
              disabled={disconnecting === "google"}
            >
              {disconnecting === "google" ? "Disconnecting…" : "Disconnect Google"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnect("whatsapp")}
              disabled={disconnecting === "whatsapp"}
            >
              {disconnecting === "whatsapp" ? "Disconnecting…" : "Disconnect WhatsApp"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { window.open("/api/user/export", "_blank"); }}
            >
              Export my data
            </Button>
          </div>
        </div>

        {/* Danger zone */}
        <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/50 p-4">
          <p className="text-xs font-medium text-red-600 uppercase tracking-wide">Danger zone</p>
          <p className="text-xs text-slate-500">
            Permanently deletes your account, all messages, contacts, and agent history.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={deleteAccount}
            disabled={deleting}
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
