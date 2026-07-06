"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  id: string;
  direction: string;
  body: string;
  from: string;
  to: string;
  timestamp: string;
}

interface WhatsAppPanelProps {
  initialNumber: string | null;
  initialConnected: boolean;
}

export function WhatsAppPanel({
  initialNumber,
  initialConnected,
}: WhatsAppPanelProps) {
  const [phoneNumber, setPhoneNumber] = useState(initialNumber ?? "");
  const [connected, setConnected] = useState(initialConnected);
  const [savedNumber, setSavedNumber] = useState(initialNumber ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [customMessage, setCustomMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/messages");
      if (res.ok) {
        const data: Message[] = await res.json();
        setMessages(data);
      }
    } catch {
      // silently ignore polling errors
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    loadMessages();

    const es = new EventSource("/api/whatsapp/stream");
    es.onmessage = (e) => {
      try {
        const msg: Message = JSON.parse(e.data);
        setMessages((prev) => [...prev, msg]);
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => es.close();

    return () => es.close();
  }, [connected, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function connectWhatsApp() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappNumber: phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save number");
      setConnected(true);
      setSavedNumber(phoneNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage(msg: string) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: savedNumber, message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setCustomMessage("");
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSending(false);
    }
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-4">
      {!connected ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Enter your WhatsApp number to connect:
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="+33612345678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="max-w-xs"
            />
            <Button
              onClick={connectWhatsApp}
              disabled={saving || !phoneNumber}
              size="sm"
              className="bg-[#2563eb] hover:bg-blue-700"
            >
              {saving ? "Saving..." : "Connect"}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              Connected:{" "}
              <span className="font-medium text-[#0f172a]">{savedNumber}</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                sendMessage(
                  "Hello from CEO Right-Hand AI! Your WhatsApp is connected."
                )
              }
              disabled={sending}
            >
              {sending ? "Sending..." : "Send Test Message"}
            </Button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Message log */}
          <div className="rounded-lg border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 px-3 py-2">
              <p className="text-xs font-medium text-slate-500">
                Message Log
              </p>
            </div>
            <div className="max-h-64 overflow-y-auto p-3 space-y-2">
              {messages.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-4">
                  No messages yet
                </p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.direction === "outbound"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                      msg.direction === "outbound"
                        ? "bg-[#2563eb] text-white"
                        : "bg-white border border-slate-200 text-[#0f172a]"
                    }`}
                  >
                    <p>{msg.body}</p>
                    <p
                      className={`mt-0.5 text-right text-[10px] ${
                        msg.direction === "outbound"
                          ? "text-blue-200"
                          : "text-slate-400"
                      }`}
                    >
                      {formatTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Send custom message */}
          <div className="flex gap-2">
            <Input
              placeholder="Type a message..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customMessage && !sending) {
                  sendMessage(customMessage);
                }
              }}
            />
            <Button
              onClick={() => sendMessage(customMessage)}
              disabled={sending || !customMessage}
              size="sm"
              className="bg-[#2563eb] hover:bg-blue-700 shrink-0"
            >
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
