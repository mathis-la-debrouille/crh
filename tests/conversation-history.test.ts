// Plain assertion script — run with: npx tsx tests/conversation-history.test.ts
import assert from "node:assert/strict";
import { buildStampedMessages, type HistoryMessage } from "../src/lib/conversation-history";

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

check("every history message is stamped with [weekday DD/MM HH:mm]", () => {
  const history: HistoryMessage[] = [
    { direction: "outbound", body: "salut !", timestamp: new Date("2026-07-20T09:00:00Z") },
    { direction: "inbound", body: "j'ai un entretien ce soir", timestamp: new Date("2026-07-21T10:26:00Z") },
  ];
  const msgs = buildStampedMessages(history, "quoi de neuf", "Europe/Paris");
  // history line stays isolated (assistant reply before it), current msg merges after it (both "user")
  assert.match(msgs[1].content, /^\[\w+\.? \d{2}\/\d{2} \d{2}:\d{2}\] j'ai un entretien ce soir\nquoi de neuf$/);
});

check("current inbound message has no timestamp prefix", () => {
  const msgs = buildStampedMessages([], "quoi de neuf", "Europe/Paris");
  assert.equal(msgs[msgs.length - 1].content, "quoi de neuf");
});

check("consecutive same-role history messages merge, each keeping its own prefix line", () => {
  const history: HistoryMessage[] = [
    { direction: "inbound", body: "salut", timestamp: new Date("2026-07-21T10:00:00Z") },
    { direction: "inbound", body: "j'ai un entretien ce soir", timestamp: new Date("2026-07-21T10:01:00Z") },
    { direction: "outbound", body: "bonne chance !", timestamp: new Date("2026-07-21T10:02:00Z") },
  ];
  const msgs = buildStampedMessages(history, "quoi de neuf", "Europe/Paris");
  // [merged user history, assistant reply, current user message] — 3 messages
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].role, "user");
  const lines = msgs[0].content.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[.+\] salut$/);
  assert.match(lines[1], /^\[.+\] j'ai un entretien ce soir$/);
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[2].content, "quoi de neuf");
});

// ── Ledger regression scenario ────────────────────────────────────────────
// Tuesday: user mentions an evening interview. Friday: user says "quoi de neuf".
// The Tuesday message must carry a Tuesday timestamp distinct from "now" so the
// agent has the information it needs to NOT treat it as still happening tonight.
check("Ledger regression: Tuesday interview message is stamped Tuesday, not today", () => {
  const tuesday = new Date("2026-07-21T18:00:00+02:00"); // Tue 21/07 18:00 Paris
  const history: HistoryMessage[] = [
    { direction: "inbound", body: "j'ai un entretien ce soir à 18h", timestamp: tuesday },
    { direction: "outbound", body: "bonne chance !", timestamp: new Date("2026-07-21T18:01:00+02:00") },
  ];
  const msgs = buildStampedMessages(history, "quoi de neuf", "Europe/Paris");
  const tuesdayMsg = msgs.find((m) => m.content.includes("entretien"));
  assert.ok(tuesdayMsg, "history should contain the interview message");
  assert.match(tuesdayMsg!.content, /21\/07/, "must carry the Tuesday date, not be silently dated 'now'");
  // The current message (Friday) is separate and unstamped — the model must derive
  // "now" from agent_config, not assume the interview note is still today's.
  const current = msgs[msgs.length - 1];
  assert.equal(current.content, "quoi de neuf");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
