// Plain assertion script — run with: npx tsx tests/search-dedup.test.ts
// Mirrors the per-loop dedup logic in claude.ts's search_emails executor
// (seenEmailIds Set<string> shared across tool calls within one runAgentLoop invocation).
import assert from "node:assert/strict";

function makeDedup() {
  const seenEmailIds = new Set<string>();
  return function dedupOrKeep<T extends { id: string }>(e: T): T | { id: string; duplicate: true } {
    if (seenEmailIds.has(e.id)) return { id: e.id, duplicate: true };
    seenEmailIds.add(e.id);
    return e;
  };
}

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

check("first occurrence of an id passes through untouched", () => {
  const dedup = makeDedup();
  const r = dedup({ id: "m1", subject: "hello" });
  assert.deepEqual(r, { id: "m1", subject: "hello" });
});

check("second occurrence within the same loop becomes a stub", () => {
  const dedup = makeDedup();
  dedup({ id: "m1", subject: "hello" });
  const r = dedup({ id: "m1", subject: "hello" });
  assert.deepEqual(r, { id: "m1", duplicate: true });
});

check("different ids never collide", () => {
  const dedup = makeDedup();
  const a = dedup({ id: "m1", subject: "a" });
  const b = dedup({ id: "m2", subject: "b" });
  assert.equal("duplicate" in a, false);
  assert.equal("duplicate" in b, false);
});

check("a fresh dedup instance (new loop) does not remember prior ids", () => {
  const dedup1 = makeDedup();
  dedup1({ id: "m1", subject: "a" });
  const dedup2 = makeDedup();
  const r = dedup2({ id: "m1", subject: "a" });
  assert.equal("duplicate" in r, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
