import { prisma } from "@/lib/prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContactData {
  displayName?: string;
  aliases?: string[];
  emails?: string[];
  relationship?: string;
  register?: string; // "tu" | "vous"
  org?: string;
  role?: string;
  toneNotes?: string;
  notes?: string;
  lastInteraction?: Date;
  emailCount?: number;
  preferredAccountId?: string; // EmailAccount.id routing hint
}

export interface ResolvedContact {
  id: string;
  displayName: string;
  aliases: string[];
  emails: string[];
  register?: string | null;
  org?: string | null;
  role?: string | null;
  toneNotes?: string | null;
  notes?: string | null;
  score: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function mergeArrays(a: string[], b: string[]): string[] {
  const set = new Set(a.map((s) => s.toLowerCase()));
  const result = [...a];
  for (const item of b) {
    if (!set.has(item.toLowerCase())) {
      result.push(item);
      set.add(item.toLowerCase());
    }
  }
  return result;
}

// ─── upsertContact ────────────────────────────────────────────────────────────

export async function upsertContact(
  userId: string,
  data: ContactData & { displayName: string }
): Promise<string> {
  const incomingEmails = data.emails ?? [];
  const incomingAliases = data.aliases ?? [];

  // Try to find existing contact by email match
  let existing: { id: string; displayName: string; aliases: string; emails: string } | null = null;

  if (incomingEmails.length > 0) {
    const all = await prisma.$queryRaw<
      { id: string; displayName: string; aliases: string; emails: string }[]
    >`SELECT id, displayName, aliases, emails FROM Contact WHERE userId = ${userId}`;

    for (const c of all) {
      const storedEmails = parseJson<string[]>(c.emails, []).map((e) => e.toLowerCase());
      const matchesEmail = incomingEmails.some((e) => storedEmails.includes(e.toLowerCase()));
      if (matchesEmail) {
        existing = c;
        break;
      }
    }
  }

  // Fallback: find by displayName (case-insensitive)
  if (!existing) {
    const byName = await prisma.$queryRaw<
      { id: string; displayName: string; aliases: string; emails: string }[]
    >`SELECT id, displayName, aliases, emails FROM Contact
      WHERE userId = ${userId} AND LOWER(displayName) = LOWER(${data.displayName})
      LIMIT 1`;
    existing = byName[0] ?? null;
  }

  if (existing) {
    // Merge and update
    const mergedEmails = mergeArrays(
      parseJson<string[]>(existing.emails, []),
      incomingEmails
    );
    const mergedAliases = mergeArrays(
      parseJson<string[]>(existing.aliases, []),
      incomingAliases
    );

    const updateFields: Record<string, unknown> = {
      emails: JSON.stringify(mergedEmails),
      aliases: JSON.stringify(mergedAliases),
      updatedAt: new Date().toISOString(),
    };
    if (data.register !== undefined) updateFields.register = data.register;
    if (data.org !== undefined) updateFields.org = data.org;
    if (data.role !== undefined) updateFields.role = data.role;
    if (data.toneNotes !== undefined) updateFields.toneNotes = data.toneNotes;
    if (data.notes !== undefined) updateFields.notes = data.notes;
    if (data.relationship !== undefined) updateFields.relationship = data.relationship;
    if (data.lastInteraction !== undefined) updateFields.lastInteraction = data.lastInteraction.toISOString();
    if (data.emailCount !== undefined) updateFields.emailCount = data.emailCount;
    if (data.preferredAccountId !== undefined) updateFields.preferredAccountId = data.preferredAccountId;

    await prisma.contact.update({
      where: { id: existing.id },
      data: updateFields as Parameters<typeof prisma.contact.update>[0]["data"],
    });

    return existing.id;
  } else {
    // Create new
    const contact = await prisma.contact.create({
      data: {
        userId,
        displayName: data.displayName,
        aliases: JSON.stringify(incomingAliases),
        emails: JSON.stringify(incomingEmails),
        relationship: data.relationship,
        register: data.register,
        org: data.org,
        role: data.role,
        toneNotes: data.toneNotes,
        notes: data.notes,
        lastInteraction: data.lastInteraction,
        emailCount: data.emailCount ?? 0,
      },
    });
    return contact.id;
  }
}

// ─── resolveContacts ──────────────────────────────────────────────────────────

export async function resolveContacts(
  userId: string,
  text: string,
  involvedEmails: string[] = []
): Promise<ResolvedContact[]> {
  const normalText = normalize(text);
  const involvedLower = involvedEmails.map((e) => e.toLowerCase());

  const all = await prisma.$queryRaw<
    {
      id: string;
      displayName: string;
      aliases: string;
      emails: string;
      register: string | null;
      org: string | null;
      role: string | null;
      toneNotes: string | null;
      notes: string | null;
    }[]
  >`SELECT id, displayName, aliases, emails, register, org, role, toneNotes, notes
    FROM Contact WHERE userId = ${userId}`;

  const scored: (ResolvedContact & { score: number })[] = [];

  for (const c of all) {
    const emails = parseJson<string[]>(c.emails, []);
    const aliases = parseJson<string[]>(c.aliases, []);
    let score = 0;

    // Email exact match in involvedEmails — highest signal
    for (const e of emails) {
      if (involvedLower.includes(e.toLowerCase())) {
        score += 10;
        break;
      }
    }

    // Email appears literally in the text
    for (const e of emails) {
      if (normalText.includes(e.toLowerCase())) {
        score += 8;
        break;
      }
    }

    // Alias exact word match in text
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      const re = new RegExp(`\\b${normAlias}\\b`);
      if (re.test(normalText)) {
        score += 6;
        break;
      }
    }

    // DisplayName parts match in text (each word counts)
    const nameParts = normalize(c.displayName).split(/\s+/);
    let nameMatches = 0;
    for (const part of nameParts) {
      if (part.length > 2) {
        const re = new RegExp(`\\b${part}\\b`);
        if (re.test(normalText)) nameMatches++;
      }
    }
    if (nameMatches > 0) score += nameMatches >= 2 ? 5 : 3;

    // Alias partial / substring match
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      if (normAlias.length > 2 && normalText.includes(normAlias)) {
        score += 1;
        break;
      }
    }

    if (score > 0) {
      scored.push({ id: c.id, displayName: c.displayName, aliases, emails, register: c.register, org: c.org, role: c.role, toneNotes: c.toneNotes, notes: c.notes, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ─── Format for system prompt injection ──────────────────────────────────────

export function formatContactsBlock(contacts: ResolvedContact[]): string {
  if (contacts.length === 0) return "";
  return contacts
    .map((c) => {
      const parts: string[] = [];
      if (c.emails[0]) parts.push(`<${c.emails[0]}>`);
      if (c.role && c.org) parts.push(`${c.role} @ ${c.org}`);
      else if (c.org) parts.push(c.org);
      else if (c.role) parts.push(c.role);
      if (c.register) parts.push(`registre: ${c.register}`);
      if (c.toneNotes) parts.push(`style: ${c.toneNotes}`);
      return `- ${c.displayName}${parts.length ? " | " + parts.join(" | ") : ""}`;
    })
    .join("\n");
}
