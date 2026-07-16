"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

interface GoogleInfo { email: string; connected: boolean; accountCount: number }
interface Props {
  google: GoogleInfo;
  whatsapp: { connected: boolean; number: string | null };
  twilioNumber: string | null;
  initialPaused: boolean;
}

export function StatusHeader({ google, whatsapp, twilioNumber, initialPaused }: Props) {
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

  const whatsappLink = twilioNumber
    ? `https://wa.me/${twilioNumber.replace(/\D/g, "")}`
    : null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
      {/* Google */}
      <StatusCard
        label="Google"
        status={google.connected ? "connected" : "disconnected"}
        detail={google.connected
          ? `${google.email}${google.accountCount > 1 ? ` · ${google.accountCount} accounts` : ""}`
          : "Not connected"}
      >
        {!google.connected && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 text-xs"
            onClick={() => signIn("google")}
          >
            Reconnect
          </Button>
        )}
      </StatusCard>

      {/* WhatsApp */}
      <StatusCard
        label="WhatsApp"
        status={whatsapp.connected ? "connected" : "disconnected"}
        detail={whatsapp.connected ? (whatsapp.number ?? "connected") : "Not connected"}
      >
        {whatsapp.connected && whatsappLink && (
          <a href={whatsappLink} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="mt-2 text-xs">Message Vayt</Button>
          </a>
        )}
      </StatusCard>

      {/* Assistant */}
      <StatusCard
        label="Assistant"
        status={paused ? "paused" : "active"}
        detail={paused ? "Replies are paused" : "Responding normally"}
      >
        <button
          onClick={togglePause}
          disabled={toggling}
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            paused
              ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
              : "bg-green-100 text-green-700 hover:bg-green-200"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-500" : "bg-green-500"}`} />
          {toggling ? "…" : paused ? "Resume" : "Pause"}
        </button>
      </StatusCard>

      {/* Subscription */}
      <StatusCard label="Subscription" status="connected" detail="Free plan">
        <p className="mt-1 text-xs text-slate-400">Billing coming soon</p>
      </StatusCard>
    </div>
  );
}

function StatusCard({
  label, status, detail, children,
}: {
  label: string;
  status: "connected" | "disconnected" | "active" | "paused";
  detail: string;
  children?: React.ReactNode;
}) {
  const dot = status === "connected" || status === "active"
    ? "bg-green-400"
    : status === "paused"
    ? "bg-amber-400"
    : "bg-slate-300";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-medium text-[#0f172a] truncate">{detail}</p>
      {children}
    </div>
  );
}
