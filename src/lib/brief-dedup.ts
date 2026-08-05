export interface BriefMemoryEntry {
  key: string;
  firstShown: string; // ISO date
}

export interface HighItem {
  senderEmail: string;
  sender: string;
  subject: string;
  snippet: string;
  prefix: string;
  emailId?: string; // used to cross-reference against OpenLoop.sourceRef, avoids double display
}

export interface DedupedItem extends HighItem {
  key: string;
  isRepeat: boolean;
}

const REPEAT_WINDOW_DAYS = 5;
const MAX_MEMORY_ENTRIES = 40;

export function parseBriefMemory(s: string): BriefMemoryEntry[] {
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is BriefMemoryEntry => typeof e?.key === "string" && typeof e?.firstShown === "string"
    );
  } catch {
    return [];
  }
}

// Subject stem: lowercased, Re:/Fwd:/Tr: stripped, digits and date punctuation removed, capped at 40 chars.
export function subjectStem(subject: string): string {
  let s = subject.toLowerCase().trim();
  while (/^(re|fwd|tr)\s*:\s*/i.test(s)) s = s.replace(/^(re|fwd|tr)\s*:\s*/i, "").trim();
  s = s.replace(/\d+/g, " ");
  s = s.replace(/[^a-zà-öø-ÿ\s]/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 40);
}

export function briefKey(senderEmail: string, subject: string): string {
  return `${senderEmail.toLowerCase()}|${subjectStem(subject)}`;
}

// Group by sender: multiple emails from the same sender become one merged line.
export function dedupBySender(items: HighItem[]): HighItem[] {
  const order: string[] = [];
  const bySender = new Map<string, HighItem[]>();
  for (const it of items) {
    if (!bySender.has(it.senderEmail)) order.push(it.senderEmail);
    const arr = bySender.get(it.senderEmail) ?? [];
    arr.push(it);
    bySender.set(it.senderEmail, arr);
  }

  return order.map((email) => {
    const group = bySender.get(email)!;
    if (group.length === 1) return group[0];
    const subjects = Array.from(new Set(group.map((g) => g.subject.trim()).filter(Boolean)));
    const snippets = Array.from(new Set(group.map((g) => g.snippet.trim()).filter(Boolean)));
    return {
      sender: group[0].sender,
      senderEmail: email,
      subject: subjects.join(", "),
      snippet: snippets.join(" ; "),
      prefix: group[0].prefix,
      emailId: group[0].emailId,
    };
  });
}

// New items first, repeats (seen within the window) after, prefixed downstream.
export function applyRepeatDetection(
  items: HighItem[],
  memory: BriefMemoryEntry[],
  now: Date = new Date(),
): { ordered: DedupedItem[]; todayKeys: string[] } {
  const cutoff = now.getTime() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentKeys = new Set(
    memory.filter((m) => new Date(m.firstShown).getTime() >= cutoff).map((m) => m.key)
  );

  const fresh: DedupedItem[] = [];
  const repeats: DedupedItem[] = [];
  const todayKeys: string[] = [];

  for (const it of items) {
    const key = briefKey(it.senderEmail, it.subject);
    todayKeys.push(key);
    const isRepeat = recentKeys.has(key);
    (isRepeat ? repeats : fresh).push({ ...it, key, isRepeat });
  }

  return { ordered: [...fresh, ...repeats], todayKeys };
}

// Prunes entries older than the window, adds today's new keys, caps at 40 (most recent first).
export function updateBriefMemory(
  memory: BriefMemoryEntry[],
  todayKeys: string[],
  now: Date = new Date(),
): BriefMemoryEntry[] {
  const cutoff = now.getTime() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const nowIso = now.toISOString();

  const map = new Map<string, string>();
  for (const m of memory) {
    if (new Date(m.firstShown).getTime() >= cutoff) map.set(m.key, m.firstShown);
  }
  for (const k of todayKeys) {
    if (!map.has(k)) map.set(k, nowIso);
  }

  const entries = Array.from(map.entries()).map(([key, firstShown]) => ({ key, firstShown }));
  entries.sort((a, b) => new Date(b.firstShown).getTime() - new Date(a.firstShown).getTime());
  return entries.slice(0, MAX_MEMORY_ENTRIES);
}
