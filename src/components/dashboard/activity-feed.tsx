import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Action {
  id: string;
  kind: string;
  summary: string;
  refId: string | null;
  accountEmail: string | null;
  createdAt: Date;
}

const KIND_ICON: Record<string, string> = {
  draft: "✉️",
  send: "📤",
  event: "📅",
  reminder: "⏰",
  reminder_deleted: "🗑️",
  brief: "☀️",
  brief_config: "☀️",
  remember: "🧠",
  loop: "🔗",
  loop_closed: "✅",
  sender_rule: "🔕",
};

function timeSince(d: Date) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)}h`;
  return `il y a ${Math.floor(s / 86400)}j`;
}

export function ActivityFeed({ actions }: { actions: Action[] }) {
  const recent = actions.slice(0, 10);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Activité récente</CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Aucune action encore — demande quelque chose à Vayt.
          </p>
        ) : (
          <div className="space-y-0.5">
            {recent.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-secondary">
                <span className="shrink-0 text-sm">{KIND_ICON[a.kind] ?? "•"}</span>
                <p className="flex-1 min-w-0 truncate text-sm text-foreground">{a.summary}</p>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground/70">{timeSince(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
