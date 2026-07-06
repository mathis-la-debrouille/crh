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
                <p className="text-xs text-slate-400">International format: +33 6 12 34 56 78</p>
              </div>
              <Input
                type="tel"
                placeholder="+33 6 12 34 56 78"
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

              <a
                href={`https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent(vaytCode)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-[#25D366] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1ebe5d] transition-colors"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Open WhatsApp to send the code
              </a>

              <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-300" />
                Waiting for your message…
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