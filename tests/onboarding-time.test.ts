// Plain assertion script — run with: npx tsx tests/onboarding-time.test.ts
import assert from "node:assert/strict";
import { parseTime } from "../src/lib/onboarding";

type Case = [string, string, ReturnType<typeof parseTime>];

const cases: Case[] = [
  ["8h30",              "8h30",            { hours: 8,  minutes: 30 }],
  ["8h",                "8h",              { hours: 8,  minutes: 0  }],
  ["18h05",             "18h05",           { hours: 18, minutes: 5  }],
  ["9:15",              "9:15",            { hours: 9,  minutes: 15 }],
  ["8am",               "8am",             { hours: 8,  minutes: 0  }],
  ["8 pm",              "8 pm",            { hours: 20, minutes: 0  }],
  ["25h — invalid",     "25h",             null],
  ["plus tard — skip",  "plus tard",       "skip"],
  ["non — skip",        "non",             "skip"],
  ["skip — skip",       "skip",            "skip"],
  ["pas maintenant",    "pas maintenant",  "skip"],
  ["fall-through mails","c'est quoi mes mails ?", null],
  ["fall-through hello","bonjour !",       null],
  ["in sentence 8h30",  "ok pour 8h30 demain", { hours: 8, minutes: 30 }],
];

let passed = 0;
let failed = 0;

for (const [label, input, expected] of cases) {
  try {
    const result = parseTime(input);
    if (typeof expected === "object" && expected !== null) {
      assert.deepEqual(result, expected);
    } else {
      assert.equal(result, expected);
    }
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    input=${JSON.stringify(input)}`);
    console.error(`    expected=${JSON.stringify(expected)}`);
    console.error(`    got=${JSON.stringify(parseTime(input))}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
