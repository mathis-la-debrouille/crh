"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Msg {
  id: string;
  direction: string;
  body: string;
  channel: string;
  timestamp: string;
}

const SUGGESTIONS = ["quoi de neuf ?", "ma journée ?", "règle mon brief à 8h30"];

export function ChatPanel({ prefill, onPrefillConsumed }: { prefill: string | null; onPrefillConsumed: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false); // true while someone else's request is in flight (409)
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<string>());
  const optimisticIdRef = useRef<string | null>(null);
  const optimisticBodyRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/chat/history?limit=50")
      .then((r) => r.json())
      .then((rows: Msg[]) => {
        rows.forEach((r) => seenIds.current.add(r.id));
        setMessages(rows);
      });
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/whatsapp/stream");
    es.onmessage = (e) => {
      let msg: (Msg & { direction: "inbound" | "outbound" }) | null = null;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg?.id) return;

      // Reconcile our own optimistic bubble with the persisted row instead of duplicating it
      if (
        msg.direction === "inbound" &&
        optimisticIdRef.current &&
        optimisticBodyRef.current === msg.body
      ) {
        const oldId = optimisticIdRef.current;
        seenIds.current.add(msg.id);
        optimisticIdRef.current = null;
        optimisticBodyRef.current = null;
        setMessages((prev) => prev.map((m) => (m.id === oldId ? { ...msg!, channel: msg!.channel ?? "web" } : m)));
        return;
      }

      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages((prev) => [...prev, { ...msg!, channel: msg!.channel ?? "whatsapp" }]);

      if (msg.direction === "outbound") {
        setPending(false);
        setBusy(false);
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (prefill !== null) {
      setInput(prefill);
      inputRef.current?.focus();
      onPrefillConsumed();
    }
  }, [prefill, onPrefillConsumed]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setInput("");

    const tempId = `tmp-${Date.now()}`;
    optimisticIdRef.current = tempId;
    optimisticBodyRef.current = trimmed;
    seenIds.current.add(tempId);
    setMessages((prev) => [
      ...prev,
      { id: tempId, direction: "inbound", body: trimmed, channel: "web", timestamp: new Date().toISOString() },
    ]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed }),
    });

    if (res.status === 409) {
      // Someone else's request (another tab, or a race) is already in flight —
      // stay disabled; the SSE outbound event will clear it when it lands.
      setBusy(true);
      return;
    }
    if (!res.ok) {
      setPending(false);
      return;
    }
    // Reply also arrives via SSE — this is belt-and-braces per the spec.
    await res.json().catch(() => null);
  }, [pending]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const disabled = pending || busy;

  return (
    <Card className="flex h-[70vh] flex-col shadow-sm">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-slate-400">Demande quelque chose à Vayt.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "inbound" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.direction === "inbound" ? "bg-blue-600 text-white" : "bg-slate-100 text-[#0f172a]"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.channel === "whatsapp" && (
                  <p className={`mt-1 text-[10px] ${m.direction === "inbound" ? "text-blue-100" : "text-slate-400"}`}>
                    via WhatsApp
                  </p>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Écris à Vayt…"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0f172a] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <Button size="sm" onClick={() => send(input)} disabled={disabled || !input.trim()}>
            {disabled ? "…" : "Envoyer"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
