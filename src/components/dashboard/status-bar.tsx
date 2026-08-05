"use client";

import { useState } from "react";

interface Props {
  whatsapp: { connected: boolean; number: string | null };
  accountsCount: number;
  initialPaused: boolean;
  brief: { enabled: boolean; time: string | null };
  onBriefChipClick: () => void;
}

function maskPhone(n: string): string {
  return n.length > 7 ? `${n.slice(0, 4)}…${n.slice(-3)}` : n;
}

export function StatusBar({ whatsapp, accountsCount, initialPaused, brief, onBriefChipClick }: Props) {
  const [paused, setPaused] = useState(initialPaused);
  const [toggling, setToggling] = useState(false);

  async function togglePause() {
    setToggling(true);
    const next = !paused;
    await fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assistantPaused: next }),
    });
    setPaused(next);
    setToggling(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm">
      {/* WhatsApp */}
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${whatsapp.connected ? "bg-green-400" : "bg-slate-300"}`} />
        {whatsapp.connected && whatsapp.number ? (
          <span className="text-slate-600">{maskPhone(whatsapp.number)}</span>
        ) : (
          <a href="/signup" className="text-blue-600 hover:underline">Connecter WhatsApp</a>
        )}
      </div>

      <span className="text-slate-200">·</span>

      {/* Accounts — anchor-scrolls to the accounts card in the sidebar */}
      <a href="#accounts-card" className="flex items-center gap-1.5 hover:underline">
        <span className={`h-2 w-2 shrink-0 rounded-full ${accountsCount > 0 ? "bg-green-400" : "bg-slate-300"}`} />
        <span className="text-slate-600">{accountsCount} compte{accountsCount > 1 ? "s" : ""} mail</span>
      </a>

      <span className="text-slate-200">·</span>

      {/* Brief chip — settings-as-chat: never opens a form, just primes the input */}
      <button
        onClick={onBriefChipClick}
        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
      >
        {brief.enabled && brief.time ? `Brief ${brief.time.replace(":", "h")}` : "Brief off"}
      </button>

      <div className="ml-auto">
        <button
          onClick={togglePause}
          disabled={toggling}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            paused
              ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
              : "bg-green-100 text-green-700 hover:bg-green-200"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-500" : "bg-green-500"}`} />
          {toggling ? "…" : paused ? "En pause" : "Actif"}
        </button>
      </div>
    </div>
  );
}
