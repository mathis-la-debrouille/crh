// Plain assertion script — run with: npx tsx tests/calendar-tz.test.ts
import assert from "node:assert/strict";
import { localToRFC3339 } from "../src/lib/calendar-tools";

const cases: [string, string, string, string][] = [
  ["Paris summer (DST, +02:00)", "2026-07-21T18:30:00", "Europe/Paris", "2026-07-21T18:30:00+02:00"],
  ["Paris winter (+01:00)", "2026-01-15T09:00:00", "Europe/Paris", "2026-01-15T09:00:00+01:00"],
  ["date-only defaults to midnight local", "2026-07-21", "Europe/Paris", "2026-07-21T00:00:00+02:00"],
  ["already has Z — passthrough", "2026-07-21T18:30:00Z", "Europe/Paris", "2026-07-21T18:30:00Z"],
  ["already has offset — passthrough", "2026-07-21T18:30:00-04:00", "Europe/Paris", "2026-07-21T18:30:00-04:00"],
  ["midnight-ish local event stays correct day", "2026-07-21T00:30:00", "Europe/Paris", "2026-07-21T00:30:00+02:00"],
];

let passed = 0;
let failed = 0;

for (const [label, input, tz, expected] of cases) {
  try {
    const result = localToRFC3339(input, tz);
    assert.equal(result, expected);
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    input=${JSON.stringify(input)} tz=${tz}`);
    console.error(`    expected=${JSON.stringify(expected)} got=${JSON.stringify(localToRFC3339(input, tz))}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
