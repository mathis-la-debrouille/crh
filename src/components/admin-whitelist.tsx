"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AllowedNumber { id: string; phone: string; note: string | null; createdAt: Date; }

export function AdminWhitelist({ initialNumbers }: { initialNumbers: AllowedNumber[] }) {
  const [numbers, setNumbers] = useState(initialNumbers);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, note }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed"); return; }
      setNumbers((prev) => [data.entry, ...prev]);
      setPhone(""); setNote("");
    } finally { setLoading(false); }
  }

  async function remove(p: string) {
    await fetch("/api/admin/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", phone: p }),
    });
    setNumbers((prev) => prev.filter((n) => n.phone !== p));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <Input placeholder="+33 6 12 34 56 78" value={phone} onChange={(e) => setPhone(e.target.value)} required className="flex-1" />
        <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="w-36" />
        <Button type="submit" size="sm" disabled={loading || !phone.trim()}>Add</Button>
      </form>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="divide-y">
        {numbers.length === 0 && <p className="py-3 text-sm text-slate-400">No numbers yet.</p>}
        {numbers.map((n) => (
          <div key={n.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <span className="font-mono text-[#0f172a]">{n.phone}</span>
              {n.note && <span className="ml-2 text-slate-400">{n.note}</span>}
            </div>
            <button onClick={() => remove(n.phone)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
