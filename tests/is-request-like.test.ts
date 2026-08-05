// Plain assertion script — run with: npx tsx tests/is-request-like.test.ts
import assert from "node:assert/strict";
import { isRequestLike, nextMorning930 } from "../src/lib/onboarding";

const cases: [string, string, boolean][] = [
  ["Détail un peu les mails", "Détail un peu les mails", true],
  ["Détail moi juste les mails reçus aujourd'hui", "Détail moi juste les mails reçus aujourd'hui", true],
  ["hi", "hi", false],
  ["Moi c'est Elliot. Tu es sur mon Google perso", "Moi c'est Elliot. Tu es sur mon Google perso", false],
  ["quoi de neuf", "quoi de neuf", true],
  ["Je suis PM chez Ledger", "Je suis PM chez Ledger", false],
];

let passed = 0;
let failed = 0;

for (const [label, input, expected] of cases) {
  try {
    const result = isRequestLike(input);
    assert.equal(result, expected);
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    input=${JSON.stringify(input)} expected=${expected} got=${isRequestLike(input)}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

// ── nextMorning930 ────────────────────────────────────────────────────────────
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); passed++; }
  catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

check("nextMorning930: lands on the next calendar day at 09:30 local (Paris summer)", () => {
  const now = new Date("2026-07-21T14:00:00+02:00"); // Tue 21/07 14:00 Paris
  const result = nextMorning930("Europe/Paris", now);
  const local = result.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  assert.equal(local, "22/07 09:30");
});

check("nextMorning930: crosses a month boundary correctly", () => {
  const now = new Date("2026-07-31T23:00:00+02:00");
  const result = nextMorning930("Europe/Paris", now);
  const local = result.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  assert.equal(local, "01/08 09:30");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
