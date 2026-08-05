"use client";

import { useState, useCallback } from "react";
import { StatusBar } from "@/components/dashboard/status-bar";
import { ChatPanel } from "@/components/dashboard/chat-panel";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { FooterLinks } from "@/components/dashboard/footer-links";
import { AccountsPanel } from "@/components/accounts-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Action {
  id: string;
  kind: string;
  summary: string;
  refId: string | null;
  accountEmail: string | null;
  createdAt: Date;
}

interface Props {
  whatsapp: { connected: boolean; number: string | null };
  accountsCount: number;
  initialPaused: boolean;
  brief: { enabled: boolean; time: string | null };
  recentActions: Action[];
}

export function DashboardShell({ whatsapp, accountsCount, initialPaused, brief, recentActions }: Props) {
  const [prefill, setPrefill] = useState<string | null>(null);

  const handleBriefChipClick = useCallback(() => setPrefill("règle mon brief à "), []);
  const handlePrefillConsumed = useCallback(() => setPrefill(null), []);

  return (
    <div className="space-y-4">
      <StatusBar
        whatsapp={whatsapp}
        accountsCount={accountsCount}
        initialPaused={initialPaused}
        brief={brief}
        onBriefChipClick={handleBriefChipClick}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ChatPanel prefill={prefill} onPrefillConsumed={handlePrefillConsumed} />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card id="accounts-card" className="shadow-sm scroll-mt-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Comptes mail</CardTitle>
                <span className="text-xs text-slate-400">{accountsCount} connecté{accountsCount > 1 ? "s" : ""}</span>
              </div>
            </CardHeader>
            <CardContent>
              <AccountsPanel />
            </CardContent>
          </Card>

          <ActivityFeed actions={recentActions} />

          <FooterLinks />
        </div>
      </div>
    </div>
  );
}
