// Plain assertion script — run with: npx tsx tests/email-triage.test.ts
import assert from "node:assert/strict";
import { classifyOne } from "../src/lib/email-classify";
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
