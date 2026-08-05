// Plain assertion script — run with: npx tsx tests/register.test.ts
import assert from "node:assert/strict";
import { detectRegister } from "../src/lib/register";

const cases: [string, string[], "tu" | "vous"][] = [
  ["Whatsup", ["Whatsup"], "tu"],
  ["Pouvez-vous vérifier vos mails", ["Pouvez-vous vérifier vos mails"], "vous"],
  ["fais ce que je t'ai dit", ["fais ce que je t'ai dit"], "tu"],
  ["empty history", [], "tu"],
];

let passed = 0;
let failed = 0;

for (const [label, input, expected] of cases) {
  try {
    const result = detectRegister(input);
    assert.equal(result, expected);
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    input=${JSON.stringify(input)} expected=${expected} got=${detectRegister(input)}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
