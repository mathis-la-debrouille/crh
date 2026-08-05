// ─── Fuzzy title matching ───────────────────────────────────────────────────
// Used by both track_loop (avoid duplicating an existing loop) and close_loop
// (resolve a fuzzy user reference like "c'est envoyé" + "le CV" to a real row).

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(s: string): Set<string> {
  return new Set(normalizeTitle(s).split(" ").filter(Boolean));
}

// Fraction of the SMALLER title's words that are shared with the other title.
export function titleWordOverlap(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of Array.from(wa)) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

const STOPWORDS = new Set([
  "le", "la", "les", "de", "des", "du", "un", "une", "a", "au", "aux", "et",
  "pour", "sur", "avec", "ce", "cet", "cette", "son", "sa", "ses",
  "mon", "ma", "mes", "ton", "ta", "tes", "que", "qui", "en",
]);

export function significantWords(s: string): Set<string> {
  return new Set(Array.from(wordSet(s)).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

export interface LoopCandidate {
  id: string;
  title: string;
  counterpart: string | null;
}

// >=60% word overlap on titles, OR same counterpart + at least one shared
// significant (non-stopword) word.
export function findMatchingLoop(
  newTitle: string,
  newCounterpart: string | null | undefined,
  candidates: LoopCandidate[]
): LoopCandidate | null {
  for (const c of candidates) {
    if (titleWordOverlap(newTitle, c.title) >= 0.6) return c;
  }
  if (newCounterpart) {
    const normCounterpart = normalizeTitle(newCounterpart);
    for (const c of candidates) {
      if (!c.counterpart || normalizeTitle(c.counterpart) !== normCounterpart) continue;
      const sw1 = significantWords(newTitle);
      const sw2 = significantWords(c.title);
      for (const w of Array.from(sw1)) {
        if (sw2.has(w)) return c;
      }
    }
  }
  return null;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function dueLabel(dueAt: Date | null, tz: string, now: Date): string | null {
  if (!dueAt) return null;
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
  const dueStr = dueAt.toLocaleDateString("en-CA", { timeZone: tz });
  if (dueStr < todayStr) return "en retard";
  if (dueStr === todayStr) return "aujourd'hui";
  return dueAt.toLocaleDateString("fr-FR", { timeZone: tz, day: "numeric", month: "long" });
}

function ageInDays(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86400000));
}

export interface LoopForPrompt {
  title: string;
  createdAt: Date;
  dueAt: Date | null;
}

// System-prompt injection — <boucles_ouvertes> block. Empty input => "".
export function buildOpenLoopsBlock(loops: LoopForPrompt[], tz: string, now: Date = new Date()): string {
  if (loops.length === 0) return "";
  const lines = loops.map((l) => {
    const days = ageInDays(l.createdAt, now);
    const due = dueLabel(l.dueAt, tz, now);
    return `- ${l.title} — depuis ${days} j${due ? ` (échéance : ${due})` : ""}`;
  });
  return `<boucles_ouvertes>\n${lines.join("\n")}\n</boucles_ouvertes>`;
}

export interface LoopForBrief {
  title: string;
  createdAt: Date;
  dueAt: Date | null;
}

// Deterministic brief opener: "2 sujets t'attendent : CV pour Hubert (3 j, échéance
// aujourd'hui) · retour CIAM (3 j)." Urgent (due today/past) loops get a ⚠️ prefix
// and sort first. Empty input => "".
export function renderLoopsLine(loops: LoopForBrief[], tz: string, tutoie: boolean, now: Date = new Date()): string {
  if (loops.length === 0) return "";

  const rendered = loops.map((l) => {
    const days = ageInDays(l.createdAt, now);
    const due = dueLabel(l.dueAt, tz, now);
    const isUrgent = due === "aujourd'hui" || due === "en retard";
    const segment = `${l.title} (${days} j${due ? `, échéance ${due}` : ""})`;
    return { segment: isUrgent ? `⚠️ ${segment}` : segment, isUrgent };
  });

  rendered.sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent));

  const verb = tutoie ? "t'attendent" : "vous attendent";
  const subjectWord = loops.length > 1 ? "sujets" : "sujet";
  return `${loops.length} ${subjectWord} ${verb} : ${rendered.map((r) => r.segment).join(" · ")}.`;
}
