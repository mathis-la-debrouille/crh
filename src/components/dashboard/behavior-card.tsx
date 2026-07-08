"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GUARDRAIL_OPTIONS = [
  { id: "review_before_send", label: "Always ask before sending emails" },
  { id: "no_calendar_solo", label: "Never modify calendar without my confirmation" },
  { id: "no_promo_reply", label: "Never reply to newsletters or marketing" },
  { id: "no_delete", label: "Never delete emails or events" },
];

interface Props {
  initialTone: string;
  initialRegister: string;
  initialLanguage: string;
  initialSignature: string;
  initialGuardrails: string;
}

export function BehaviorCard({ initialTone, initialRegister, initialLanguage, initialSignature, initialGuardrails }: Props) {
  const parseGuardrails = (raw: string): string[] => {
    try { return JSON.parse(raw); } catch { return []; }
  };

  const [tone, setTone] = useState(initialTone || "formal");
  const [register, setRegister] = useState(initialRegister || "vous");
  const [language, setLanguage] = useState(initialLanguage || "fr");
  const [signature, setSignature] = useState(initialSignature || "");
  const [guardrails, setGuardrails] = useState<string[]>(parseGuardrails(initialGuardrails));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleGuardrail(id: string) {
    setGuardrails((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  async function save() {
    setSaving(true);
    await fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone, register, language, signature, guardrails: JSON.stringify(guardrails) }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Assistant behavior</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="formal">Formal</option>
              <option value="casual">Casual</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Register</label>
            <select
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="vous">Vous</option>
              <option value="tu">Tu</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Default email signature</label>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={3}
            placeholder={"Jean Dupont\nCEO, Acme"}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-500">Guardrails</label>
          {GUARDRAIL_OPTIONS.map(({ id, label }) => (
            <label key={id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={guardrails.includes(id)}
                onChange={() => toggleGuardrail(id)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span className="text-sm text-slate-700">{label}</span>
            </label>
          ))}
        </div>

        <Button size="sm" onClick={save} disabled={saving} className="bg-[#2563eb] hover:bg-blue-700 text-white">
          {saved ? "Saved" : saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
