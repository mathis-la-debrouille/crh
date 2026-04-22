import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReactNode } from "react";

interface ConnectionCardProps {
  title: string;
  icon: ReactNode;
  connected: boolean;
  children: ReactNode;
}

export function ConnectionCard({
  title,
  icon,
  connected,
  children,
}: ConnectionCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{icon}</span>
            <CardTitle className="text-base font-semibold text-[#0f172a]">
              {title}
            </CardTitle>
          </div>
          <Badge
            variant={connected ? "default" : "secondary"}
            className={
              connected
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                : "bg-slate-100 text-slate-500"
            }
          >
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
