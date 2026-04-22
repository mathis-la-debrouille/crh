"use client";

import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { data: session } = useSession();

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-[#0f172a]">
            CEO Right-Hand
          </span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Phase 0
          </span>
        </div>

        {session?.user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-[#0f172a]">
                {session.user.name}
              </p>
              <p className="text-xs text-slate-500">{session.user.email}</p>
            </div>
            <Avatar className="h-9 w-9">
              <AvatarImage src={session.user.image ?? undefined} />
              <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
