// Plain assertion script — run with: npx tsx tests/brief-dedup.test.ts
import assert from "node:assert/strict";
import {
  subjectStem, briefKey, dedupBySender, applyRepeatDetection, updateBriefMemory,
  type HighItem, type BriefMemoryEntry,
} from "../src/lib/brief-dedup";

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function item(over: Partial<HighItem>): HighItem {
  return { sender: "Google Cloud", senderEmail: "billing@google.com", subject: "s", snippet: "", prefix: "", ...over };
}

// ── subjectStem ─────────────────────────────────────────────────────────────
check("strips Re:/Fwd: prefixes and lowercases", () => {
  assert.equal(subjectStem("Re: Fwd: Facture N°44190456649001"), "facture n");
});
check("strips digits and dates", () => {
  assert.equal(subjectStem("Rappel du 21/07/2026"), "rappel du");
});
check("caps at 40 chars", () => {
  const long = "a".repeat(60);
  assert.equal(subjectStem(long).length, 40);
});

// ── dedupBySender ────────────────────────────────────────────────────────────
check("single item passes through unchanged", () => {
  const [r] = dedupBySender([item({ subject: "risque de suspension" })]);
  assert.equal(r.subject, "risque de suspension");
});
check("same sender, multiple emails → one merged line", () => {
  const merged = dedupBySender([
    item({ subject: "projet Alina : risque de suspension" }),
    item({ subject: "facturation à régulariser" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].subject, "projet Alina : risque de suspension, facturation à régulariser");
});
check("different senders stay separate", () => {
  const merged = dedupBySender([
    item({ senderEmail: "a@x.com", subject: "one" }),
    item({ senderEmail: "b@x.com", subject: "two" }),
  ]);
  assert.equal(merged.length, 2);
});

// ── applyRepeatDetection + updateBriefMemory (day-over-day scenario) ────────
check("day 1: no memory → item renders as new, not a repeat", () => {
  const { ordered, todayKeys } = applyRepeatDetection(
    [item({ subject: "risque de suspension" })],
    [],
  );
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].isRepeat, false);
  assert.equal(todayKeys.length, 1);
});

check("day 2: same key within 5 days → repeat, placed after fresh items", () => {
  const day1 = applyRepeatDetection([item({ subject: "risque de suspension" })], []);
  const day1Memory = updateBriefMemory([], day1.todayKeys, new Date("2026-07-20T08:00:00Z"));

  const day2Items = [
    item({ senderEmail: "new@sender.com", sender: "New Sender", subject: "nouveau sujet" }),
    item({ subject: "risque de suspension" }), // same sender+subject as day 1
  ];
  const day2 = applyRepeatDetection(day2Items, day1Memory, new Date("2026-07-21T08:00:00Z"));

  assert.equal(day2.ordered.length, 2);
  assert.equal(day2.ordered[0].isRepeat, false, "fresh item comes first");
  assert.equal(day2.ordered[1].isRepeat, true, "repeat item comes after");
  assert.equal(day2.ordered[1].senderEmail, "billing@google.com");
});

check("repeat older than 5 days is treated as new again", () => {
  const day1 = applyRepeatDetection([item({ subject: "risque de suspension" })], []);
  const oldMemory = updateBriefMemory([], day1.todayKeys, new Date("2026-07-01T08:00:00Z"));

  const later = applyRepeatDetection(
    [item({ subject: "risque de suspension" })],
    oldMemory,
    new Date("2026-07-21T08:00:00Z"), // 20 days later, past the 5-day window
  );
  assert.equal(later.ordered[0].isRepeat, false);
});

check("updateBriefMemory caps at 40 entries", () => {
  const many: string[] = Array.from({ length: 50 }, (_, i) => `k${i}`);
  const mem = updateBriefMemory([], many);
  assert.equal(mem.length, 40);
});

check("updateBriefMemory keeps firstShown stable across days (doesn't reset the clock)", () => {
  const day1Memory: BriefMemoryEntry[] = [{ key: "billing@google.com|risque de suspension", firstShown: "2026-07-20T08:00:00.000Z" }];
  const day2Memory = updateBriefMemory(day1Memory, ["billing@google.com|risque de suspension"], new Date("2026-07-21T08:00:00Z"));
  assert.equal(day2Memory[0].firstShown, "2026-07-20T08:00:00.000Z");
});

check("briefKey ignores Re:/digits, so repeated threads collapse to the same key", () => {
  const k1 = briefKey("a@x.com", "Google Cloud — risque du 21/07");
  const k2 = briefKey("a@x.com", "Re: Google Cloud — risque du 22/07");
  assert.equal(k1, k2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
