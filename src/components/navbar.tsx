"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
];

export function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="border-b border-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-bold text-foreground">
              Vayt<span className="text-primary">.</span>
            </span>
          </div>
          {session?.user && (
            <nav className="hidden items-center gap-1 sm:flex">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-full px-3 py-1.5 font-display text-sm font-medium transition-colors ${
                    pathname === l.href
                      ? "bg-foreground text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
              {session.isAdmin && (
                <>
                  <Link
                    href="/metrics"
                    className={`rounded-full px-3 py-1.5 font-display text-sm font-medium transition-colors ${
                      pathname === "/metrics" ? "bg-foreground text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    Metrics
                  </Link>
                  <Link
                    href="/admin"
                    className={`rounded-full px-3 py-1.5 font-display text-sm font-medium transition-colors ${
                      pathname === "/admin" ? "bg-foreground text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    Admin
                  </Link>
                </>
              )}
            </nav>
          )}
        </div>

        {session?.user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-foreground">{session.user.name}</p>
              <p className="text-xs text-muted-foreground">{session.user.email}</p>
            </div>
            <Avatar className="h-9 w-9">
              <AvatarImage src={session.user.image ?? undefined} />
              <AvatarFallback className="bg-primary/15 text-sm font-semibold text-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await signOut({ redirect: false });
                window.location.href = "/";
              }}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
