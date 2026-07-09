import { searchEmails, readEmail } from "@/lib/gmail-tools";
import { makeTokenProvider } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { prisma } from "@/lib/prisma";
import { CLAUDE_API } from "@/lib/claude";
import { ADMIN_EMAIL } from "@/lib/auth";

function stripQuoted(body: string): string {
  const lines = body.split("\n");
  const cut = lines.findIndex((l) =>
    /^>|^De ?:|^Le .{10,60} a écrit|^On .{10,60} wrote|^-{5,}/.test(l)
  );
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

export async function analyzeWritingStyle(userId: string): Promise<void> {
  try {
    const [adminRow, accounts] = await Promise.all([
      prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { claudeApiKey: true } }),
      getConnectedAccounts(userId),
    ]);

    const apiKey = adminRow?.claudeApiKey;
    if (!apiKey || accounts.length === 0) return;

    const getToken = makeTokenProvider();
    let token: string;
    try {
      token = await getToken(accounts[0].id);
    } catch {
      return;
    }

    const summaries = await searchEmails(token, "in:sent -to:me newer_than:180d", 25);
    if (summaries.length === 0) return;

    const bodies: string[] = [];
    for (let i = 0; i < summaries.length; i += 5) {
      const batch = summaries.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async (s) => {
          const full = await readEmail(token, s.id);
          return stripQuoted(full.body ?? "");
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.length >= 40) {
          bodies.push(r.value);
        }
      }
    }

    if (bodies.length < 3) return;

    const combined = bodies
      .map((b) => b.slice(0, 1500))
      .join("\n---\n")
      .slice(0, 30000);

    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system:
          "Tu analyses des emails envoyés par une personne pour créer son profil de style d'écriture. " +
          "Réponds UNIQUEMENT avec le profil, format : une ligne par caractéristique, max 10 lignes. " +
          "Caractéristiques : langue(s), registre par défaut (tu/vous), salutations habituelles, " +
          "formules de clôture, signature, longueur typique, ponctuation et emoji, expressions récurrentes. " +
          "Sois factuel et concis — ce profil servira à écrire des emails à sa place.",
        messages: [{ role: "user", content: combined }],
      }),
    });

    if (!res.ok) return;
    const data = await res.json();
    const profile: string = data.content?.[0]?.text ?? "";
    if (!profile.trim()) return;

    await prisma.user.update({
      where: { id: userId },
      data: { writingStyle: profile, styleAnalyzedAt: new Date() },
    });
    console.log(`[style] profile generated for ${userId} from ${bodies.length} emails`);
  } catch (err) {
    console.error("[style] analyzeWritingStyle failed:", err instanceof Error ? err.message : err);
  }
}
