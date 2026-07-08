import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Action {
  id: string;
  kind: string;
  summary: string;
  refId: string | null;
  accountEmail: string | null;
  createdAt: Date;
}

const KIND_STYLE: Record<string, string> = {
  draft: "bg-blue-50 text-blue-600",
  send: "bg-green-50 text-green-700",
  event: "bg-violet-50 text-violet-600",
  reminder: "bg-amber-50 text-amber-600",
  brief: "bg-slate-100 text-slate-500",
  remember: "bg-indigo-50 text-indigo-600",
};

function timeSince(d: Date) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ActivityFeed({ actions }: { actions: Action[] }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent activity</CardTitle>
          <span className="text-xs text-slate-400">Last 20 actions</span>
        </div>
      </CardHeader>
      <CardContent>
        {actions.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No activity yet — start chatting on WhatsApp.</p>
        ) : (
          <div className="space-y-0.5">
            {actions.map((a) => {
              const kindStyle = KIND_STYLE[a.kind] ?? "bg-slate-100 text-slate-500";
              const isGmailDraft = a.kind === "draft" && a.refId;
              return (
                <div key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-px text-xs font-medium ${kindStyle}`}>
                    {a.kind}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#0f172a] truncate">{a.summary}</p>
                    {a.accountEmail && (
                      <p className="text-xs text-slate-400">{a.accountEmail}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {isGmailDraft && (
                      <a
                        href={`https://mail.google.com/mail/u/0/#drafts/${a.refId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-500 hover:underline"
                      >
                        View draft
                      </a>
                    )}
                    <span className="text-xs text-slate-300 whitespace-nowrap">{timeSince(a.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
