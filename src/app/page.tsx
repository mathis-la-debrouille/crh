import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/sign-in-button";

export default async function LandingPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white to-slate-100 px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">
            CEO Right-Hand AI
          </h1>
          <p className="mt-3 text-lg text-slate-600">
            Your AI-powered executive assistant.
          </p>
          <p className="mt-1 text-sm text-slate-400">Phase 0 — Integrations</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-[#0f172a]">
              Get started
            </h2>
            <p className="text-sm text-slate-500">
              Sign in with your Google account to connect Gmail and Calendar.
            </p>
          </div>

          <SignInButton />

          <p className="text-xs text-slate-400">
            We request read-only access to Gmail and Calendar. Your data never
            leaves your session.
          </p>
        </div>

        <div className="flex justify-center gap-6 text-sm text-slate-400">
          <span className="flex items-center gap-1">
            <span>✅</span> Gmail
          </span>
          <span className="flex items-center gap-1">
            <span>✅</span> Google Calendar
          </span>
          <span className="flex items-center gap-1">
            <span>✅</span> WhatsApp
          </span>
        </div>
      </div>
    </main>
  );
}
