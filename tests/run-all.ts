// Runs every *.test.ts in this directory as a separate process, sequentially.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = __dirname;
const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts")).sort();

let failed = 0;
for (const file of files) {
  console.log(`\n─── ${file} ───`);
  const res = spawnSync("npx", ["tsx", path.join(dir, file)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log(`\n${files.length - failed}/${files.length} test files passed`);
if (failed > 0) process.exit(1);
