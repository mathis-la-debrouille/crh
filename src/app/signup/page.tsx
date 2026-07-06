"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "phone" | "waiting" | "google";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const params = useSearchParams();
  const errorParam = params.get("error");

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [vaytCode, setVaytCode] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "phone_required" ? "Please verify your phone number first." :
      errorParam === "phone_expired" ? "Verification expired — please start again." :
        null
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function startPolling(phoneNum: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/check-verification?phone=${encodeURIComponent(phoneNum)}`);
        const data = await res.json();
        if (data.verified) {
          clearInterval(pollRef.current!);
          setStep("google");
        }
      } catch {
        // network blip — keep polling
      }
    }, 2500);
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "not_allowed" ? "This number isn't on the access list." :
            data.error === "too_many_requests" ? "Too many requests — wait a few minutes." :
              "Something went wrong. Check the number and try again."
        );
        return;
      }
      setVaytCode(data.code);
      setWaNumber(data.whatsappNumber);
      setStep("waiting");
      startPolling(phone);
    } finally {
      setLoading(false);
    }
  }

  function connectGoogle() {
    signIn("google", { callbackUrl: "/dashboard" });
  }

  const stepIndex = { phone: 0, waiting: 1, google: 2 };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white to-slate-100 px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#0f172a]">Vayt AI</h1>
          <p className="mt-2 text-slate-500">Your AI executive assistant</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm space-y-5">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
            {(["phone", "waiting", "google"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="h-px w-8 bg-slate-200" />}
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${step === s ? "bg-[#0f172a] text-white" :
                  stepIndex[step] > i ? "bg-slate-200 text-slate-600" :
                    "border border-slate-200 text-slate-300"
                  }`}>
                  {i + 1}
                </span>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
          )}

          {step === "phone" && (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-1 text-left">
                <p className="text-sm font-medium text-[#0f172a]">Enter your WhatsApp number</p>
                <p className="text-xs text-slate-400">International format: +33 7 82 74 80 20</p>
              </div>
              <Input
                type="tel"
                placeholder="+33 7 82 74 80 20"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
              <Button type="submit" className="w-full" disabled={loading || !phone.trim()}>
                {loading ? "Please wait…" : "Continue"}
              </Button>
            </form>
          )}

          {step === "waiting" && (
            <div className="space-y-5">
              <div className="space-y-1 text-left">
                <p className="text-sm font-medium text-[#0f172a]">Send this code on WhatsApp</p>
                <p className="text-xs text-slate-400">Open WhatsApp and send the code below to our number.</p>
              </div>

              <div className="rounded-xl bg-slate-50 py-5 text-center">
                <p className="font-mono text-3xl font-bold tracking-widest text-[#0f172a] select-all">{vaytCode}</p>
              </div>

              <div className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm">
                <p className="text-xs text-slate-400 mb-1">Send to this number</p>
                <p className="font-mono font-semibold text-[#0f172a]">{waNumber}</p>
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-300" />
                Waiting for your WhatsApp message…
              </div>

              <button
                type="button"
                onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setStep("phone"); setError(null); }}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Wrong number? Start over
              </button>
            </div>
          )}

          {step === "google" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 font-medium">
                Number verified
              </div>
              <div className="space-y-1 text-left">
                <p className="text-sm font-medium text-[#0f172a]">Connect your Google account</p>
                <p className="text-xs text-slate-400">To access Gmail and Calendar.</p>
              </div>
              <Button onClick={connectGoogle} className="w-full">
                Continue with Google
              </Button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400">
          Already have an account?{" "}
          <button
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="underline hover:text-slate-600"
          >
            Sign in
          </button>
        </p>
      </div>
    </main>
  );
}