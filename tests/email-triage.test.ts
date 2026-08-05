// Plain assertion script — run with: npx tsx tests/email-triage.test.ts
import assert from "node:assert/strict";
import { classifyOne, formatNoiseSenders, type SenderRuleAction, type TriagedEmail } from "../src/lib/email-classify";
import type { EmailSummary } from "../src/lib/gmail-tools";

function make(overrides: { from: string; subject: string } & Partial<EmailSummary>): EmailSummary {
  return {
    id: "msg-1",
    date: "Mon, 7 Jul 2026 09:00:00 +0200",
    snippet: "",
    labelIds: [],
    listUnsubscribe: false,
    precedenceBulk: false,
    ...overrides,
  };
}

const NONE = new Set<string>();

const cases: [string, EmailSummary, Set<string>, string, string][] = [
  ["noreply@twitch.tv no transactional → notification/low",
    make({ from: "Twitch <noreply@twitch.tv>", subject: "Inoxtag est en live", snippet: "rejoin le stream" }),
    NONE, "notification", "low"],

  ["Medium digest listUnsubscribe=true → newsletter/low",
    make({ from: "Medium <noreply@medium.com>", subject: "Your daily reads", listUnsubscribe: true }),
    NONE, "newsletter", "low"],

  ["automated@airbnb.com réservation, no urgency → transactional/normal",
    make({ from: "Airbnb <automated@airbnb.com>", subject: "Re: réservation Écusson" }),
    NONE, "transactional", "normal"],

  ["automated@airbnb.com réservation + urgent snippet → transactional/high",
    make({ from: "Airbnb <automated@airbnb.com>", subject: "Re: réservation Écusson", snippet: "action requise avant demain" }),
    NONE, "transactional", "high"],

  ["known contact with CATEGORY_UPDATES → human/high",
    make({ from: "Marie Dupont <marie@example.com>", subject: "update", labelIds: ["CATEGORY_UPDATES"] }),
    new Set(["marie@example.com"]), "human", "high"],

  ["unknown human plain subject → human/normal",
    make({ from: "Jean Martin <jean@startup.io>", subject: "Re: notre réunion" }),
    NONE, "human", "normal"],

  ["unknown human + avant demain in snippet → human/high",
    make({ from: "Jean Martin <jean@startup.io>", subject: "Re: notre réunion", snippet: "peux-tu confirmer avant demain ?" }),
    NONE, "human", "high"],

  ["CATEGORY_PROMOTIONS → promo/low",
    make({ from: "Shop <promo@shop.com>", subject: "-50% ce week-end", labelIds: ["CATEGORY_PROMOTIONS"] }),
    NONE, "promo", "low"],

  ["jobs@meta.com noise subject → notification/low",
    make({ from: "Meta Careers <jobs@meta.com>", subject: "aucune nouvelle offre pour toi" }),
    NONE, "notification", "low"],

  ["CETELEM dossier règlement + listUnsubscribe → transactional/high",
    make({ from: "CETELEM <noreply@cetelem.fr>", subject: "CETELEM - Votre Dossier N° 44190456649001 - Règlement", listUnsubscribe: true, labelIds: ["CATEGORY_UPDATES"] }),
    NONE, "transactional", "high"],

  ["règlement européen IA, no co-signal → newsletter/low",
    make({ from: "Newsletter <news@lalettre.fr>", subject: "Nouveau règlement européen sur l'IA", listUnsubscribe: true }),
    NONE, "newsletter", "low"],

  ["prélèvement du 15 juillet + listUnsubscribe → transactional/high",
    make({ from: "Ma Banque <noreply@mabanque.fr>", subject: "Votre prélèvement du 15 juillet", listUnsubscribe: true }),
    NONE, "transactional", "high"],

  ["Invitation (expéditeur inconnu): Mathis x Ledger → invitation/normal",
    make({ from: "Quentin Ledger <quentin@ledger.com>", subject: "Invitation : Mathis x Ledger" }),
    NONE, "invitation", "normal"],
];

let passed = 0;
let failed = 0;

for (const [label, email, known, expectedCat, expectedPri] of cases) {
  try {
    const r = classifyOne(email, known);
    assert.equal(r.category, expectedCat, `category mismatch`);
    assert.equal(r.priority, expectedPri, `priority mismatch`);
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); passed++; }
  catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

// ── Sender rules ─────────────────────────────────────────────────────────────
check("rule 'upstream.so' mute → priority low even though transactional lexicon matches", () => {
  const email = make({ from: "Upstream <noreply@upstream.so>", subject: "Confirmation de commande", listUnsubscribe: true });
  const rules = new Map<string, SenderRuleAction>([["upstream.so", "mute"]]);
  const r = classifyOne(email, NONE, rules);
  assert.equal(r.priority, "low");
});

check("rule 'scarfo.com' always_show → newsletter comes back priority high, category unchanged", () => {
  const email = make({ from: "Scarfo <news@scarfo.com>", subject: "La lettre de Scarfo", listUnsubscribe: true });
  const rules = new Map<string, SenderRuleAction>([["scarfo.com", "always_show"]]);
  const r = classifyOne(email, NONE, rules);
  assert.equal(r.category, "newsletter");
  assert.equal(r.priority, "high");
});

check("full-email rule key does NOT apply to other senders on the same domain", () => {
  const email = make({ from: "Marie <marie@x.fr>", subject: "Re: notre réunion" });
  const rules = new Map<string, SenderRuleAction>([["jean@x.fr", "mute"]]);
  const r = classifyOne(email, NONE, rules);
  assert.equal(r.priority, "normal"); // unaffected — rule was keyed to a different address
});

check("domain rule key DOES apply to any sender on that domain", () => {
  const email = make({ from: "Marie <marie@x.fr>", subject: "Re: notre réunion" });
  const rules = new Map<string, SenderRuleAction>([["x.fr", "mute"]]);
  const r = classifyOne(email, NONE, rules);
  assert.equal(r.priority, "low");
});

check("full-email rule key DOES apply to that exact address", () => {
  const email = make({ from: "Jean <jean@x.fr>", subject: "Re: notre réunion" });
  const rules = new Map<string, SenderRuleAction>([["jean@x.fr", "always_show"]]);
  const r = classifyOne(email, NONE, rules);
  assert.equal(r.priority, "high");
});

check("no matching rule → normal classification unaffected", () => {
  const email = make({ from: "Twitch <noreply@twitch.tv>", subject: "Inoxtag est en live" });
  const rules = new Map<string, SenderRuleAction>([["scarfo.com", "always_show"]]);
  const r = classifyOne(email, NONE, rules);
  assert.equal(r.category, "notification");
  assert.equal(r.priority, "low");
});

// ── formatNoiseSenders ───────────────────────────────────────────────────────
function noiseEmail(from: string): TriagedEmail {
  return { ...make({ from, subject: "x" }), category: "newsletter", priority: "low" };
}

check("formatNoiseSenders: matches the spec example", () => {
  const noise = [
    ...Array(6).fill(0).map(() => noiseEmail("Upstream <no-reply@upstream.so>")),
    noiseEmail("Medium <noreply@medium.com>"),
    noiseEmail("Twitch <noreply@twitch.tv>"),
  ];
  assert.equal(formatNoiseSenders(noise), "Upstream ×6, Medium, Twitch");
});

check("formatNoiseSenders: caps at 4 distinct senders with a trailing ellipsis", () => {
  const noise = ["A", "B", "C", "D", "E"].map((n) => noiseEmail(`${n} <n@${n.toLowerCase()}.com>`));
  const result = formatNoiseSenders(noise);
  assert.equal(result, "A, B, C, D…");
});

check("formatNoiseSenders: falls back to domain when no display name", () => {
  const noise = [noiseEmail("noreply@upstream.so")];
  assert.equal(formatNoiseSenders(noise), "upstream.so");
});

check("formatNoiseSenders: empty input → empty string", () => {
  assert.equal(formatNoiseSenders([]), "");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
