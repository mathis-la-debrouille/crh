// Plain assertion script — run with: npx tsx tests/open-loops.test.ts
import assert from "node:assert/strict";
import {
  findMatchingLoop, titleWordOverlap, buildOpenLoopsBlock, renderLoopsLine,
  type LoopCandidate,
} from "../src/lib/open-loops";

let passed = 0;
let failed = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); passed++; }
  catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

// ── titleWordOverlap / findMatchingLoop ─────────────────────────────────────
check("near-identical titles overlap >= 0.6", () => {
  assert.ok(titleWordOverlap("CV à envoyer à Hubert", "envoyer CV Hubert") >= 0.6);
});

check("unrelated titles overlap well under 0.6", () => {
  assert.ok(titleWordOverlap("CV à envoyer à Hubert", "dentiste rendez-vous mardi") < 0.6);
});

const candidates: LoopCandidate[] = [
  { id: "1", title: "CV à envoyer à Hubert", counterpart: "Hubert Guislain" },
  { id: "2", title: "retour poste CIAM à Hubert", counterpart: "Hubert Guislain" },
];

check("findMatchingLoop: paraphrase of an existing title matches by overlap", () => {
  const m = findMatchingLoop("envoyer mon CV à Hubert", undefined, candidates);
  assert.equal(m?.id, "1");
});

check("findMatchingLoop: same counterpart + shared significant word matches even with low overlap", () => {
  const m = findMatchingLoop("CIAM — relancer Hubert", "Hubert Guislain", candidates);
  assert.equal(m?.id, "2");
});

check("findMatchingLoop: genuinely new subject does not match", () => {
  const m = findMatchingLoop("réserver le restaurant pour vendredi", "Marie", candidates);
  assert.equal(m, null);
});

check("findMatchingLoop: empty candidate list never matches", () => {
  const m = findMatchingLoop("anything", "anyone", []);
  assert.equal(m, null);
});

// ── buildOpenLoopsBlock (prompt injection) ──────────────────────────────────
check("buildOpenLoopsBlock: empty loops => empty string", () => {
  assert.equal(buildOpenLoopsBlock([], "Europe/Paris"), "");
});

check("buildOpenLoopsBlock: renders age + échéance with colon", () => {
  const now = new Date("2026-07-24T10:00:00+02:00");
  const loops = [
    { title: "CV à envoyer à Hubert", createdAt: new Date("2026-07-21T10:00:00+02:00"), dueAt: new Date("2026-07-24T00:00:00+02:00") },
  ];
  const block = buildOpenLoopsBlock(loops, "Europe/Paris", now);
  assert.ok(block.startsWith("<boucles_ouvertes>\n"));
  assert.ok(block.includes("CV à envoyer à Hubert — depuis 3 j (échéance : aujourd'hui)"));
  assert.ok(block.endsWith("</boucles_ouvertes>"));
});

check("buildOpenLoopsBlock: no dueAt => no échéance suffix", () => {
  const now = new Date("2026-07-24T10:00:00+02:00");
  const loops = [{ title: "retour CIAM", createdAt: new Date("2026-07-21T10:00:00+02:00"), dueAt: null }];
  const block = buildOpenLoopsBlock(loops, "Europe/Paris", now);
  assert.ok(block.includes("retour CIAM — depuis 3 j"));
  assert.ok(!block.includes("échéance"));
});

// ── renderLoopsLine (brief opener) ──────────────────────────────────────────
check("renderLoopsLine: empty loops => empty string", () => {
  assert.equal(renderLoopsLine([], "Europe/Paris", true), "");
});

check("renderLoopsLine: matches the spec example format", () => {
  const now = new Date("2026-07-24T10:00:00+02:00");
  const loops = [
    { title: "CV pour Hubert", createdAt: new Date("2026-07-21T10:00:00+02:00"), dueAt: new Date("2026-07-24T00:00:00+02:00") },
    { title: "retour CIAM", createdAt: new Date("2026-07-21T10:00:00+02:00"), dueAt: null },
  ];
  const line = renderLoopsLine(loops, "Europe/Paris", true, now);
  assert.equal(line, "2 sujets t'attendent : ⚠️ CV pour Hubert (3 j, échéance aujourd'hui) · retour CIAM (3 j).");
});

check("renderLoopsLine: urgent (due today/past) loops sort first", () => {
  const now = new Date("2026-07-24T10:00:00+02:00");
  const loops = [
    { title: "pas urgent", createdAt: now, dueAt: new Date("2026-08-01T00:00:00+02:00") },
    { title: "en retard", createdAt: now, dueAt: new Date("2026-07-20T00:00:00+02:00") },
  ];
  const line = renderLoopsLine(loops, "Europe/Paris", true, now);
  assert.ok(line.indexOf("en retard") < line.indexOf("pas urgent"));
});

check("renderLoopsLine: vouvoiement uses 'vous attendent'", () => {
  const now = new Date("2026-07-24T10:00:00+02:00");
  const line = renderLoopsLine([{ title: "x", createdAt: now, dueAt: null }], "Europe/Paris", false, now);
  assert.ok(line.includes("vous attendent"));
});

check("renderLoopsLine: singular 'sujet' for one loop", () => {
  const now = new Date("2026-07-24T10:00:00+02:00");
  const line = renderLoopsLine([{ title: "x", createdAt: now, dueAt: null }], "Europe/Paris", true, now);
  assert.ok(line.startsWith("1 sujet t'attendent"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
