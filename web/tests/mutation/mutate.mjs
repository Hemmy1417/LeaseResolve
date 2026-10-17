// Mutation sweep for the web rules (pnpm mutate): break one rule at a time in
// web/lib, run the tests that cover it, and require a failure. A green suite
// proves the tests run; this proves they would notice.
//
// Every file is restored in a finally block, and the run ends by comparing
// each one against its contents before the sweep began.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../..", import.meta.url));
const NODE = process.execPath;
const VITEST = join(WEB, "node_modules/vitest/vitest.mjs");

const M = [
  // ── who may act ───────────────────────────────────────────────────────
  ["acts", "the landlord may accept the offer",
   `    if (me === "TENANT") add("accept_lease", "Accept and pay the deposit", true);`,
   `    if (me) add("accept_lease", "Accept and pay the deposit", true);`],
  ["acts", "the tenant may withdraw the offer",
   `      add("cancel_lease", "Withdraw the offer", true);\n    }`,
   `      add("cancel_lease", "Withdraw the offer", true);\n    }\n    if (me === "TENANT") add("cancel_lease", "Withdraw the offer", true);`],
  ["acts", "the landlord files repair notices",
   `    if (me === "TENANT") {\n      const notices`,
   `    if (me) {\n      const notices`],
  ["acts", "a stranger asks for a ruling",
   `    if (me) add("request_ruling", "Ask the validators for a ruling", true);`,
   `    if (connected) add("request_ruling", "Ask the validators for a ruling", true);`],
  ["acts", "the winner on every deduction may appeal",
   `      add("open_appeal", "Appeal the ruling", open && lost,`,
   `      add("open_appeal", "Appeal the ruling", open,`],
  ["acts", "concessions are offered under appeal",
   `const OPEN_TO_CONCESSION = ["RESPONSE", "AWAITING_RULING", "RULED"];`,
   `const OPEN_TO_CONCESSION = ["RESPONSE", "AWAITING_RULING", "RULED", "APPEALED"];`],
  ["acts", "the tenant is offered an answer for a disputed deduction",
   `      if (d.state !== "CLAIMED") continue;\n      if (me === "TENANT") {`,
   `      if (d.state === "WITHDRAWN") continue;\n      if (me === "TENANT") {`],

  // ── windows, both sides ───────────────────────────────────────────────
  ["acts", "a boundary counts as passed when it is reached",
   `export const past = (iso: string, nowMs: number) => nowMs > ms(iso);`,
   `export const past = (iso: string, nowMs: number) => nowMs >= ms(iso);`],
  ["acts", "the baseline stays open after check-in",
   `    const open = !past(lease.check_in_ends, nowMs);\n    if (me) {`,
   `    const open = true;\n    if (me) {`],
  ["acts", "anyone closes the baseline at once",
   `      add("confirm_baseline", "Close the baseline and start the tenancy", !open,`,
   `      add("confirm_baseline", "Close the baseline and start the tenancy", true,`],
  ["acts", "anyone ends the tenancy before the term",
   `      add("end_tenancy", "End the tenancy at the end of the term", past(lease.ends_at, nowMs),`,
   `      add("end_tenancy", "End the tenancy at the end of the term", true,`],
  ["acts", "claims stay open after the period",
   `    const open = !past(lease.claims_ends, nowMs);`,
   `    const open = true;`],
  ["acts", "answers stay open after the period",
   `    const open = !past(lease.response_ends, nowMs);`,
   `    const open = true;`],
  ["acts", "the long stop opens at once",
   `      add("settle_unresolved", "Split what no ruling could settle", past(lease.ruling_long_stop, nowMs),`,
   `      add("settle_unresolved", "Split what no ruling could settle", true,`],
  ["acts", "a ruling settles inside its appeal window",
   `      add("finalize", "Settle on the ruling", !open,`,
   `      add("finalize", "Settle on the ruling", true,`],
  ["acts", "an appeal is decided inside its evidence period",
   `      add("decide_appeal", "Ask the validators to decide the appeal", !open,`,
   `      add("decide_appeal", "Ask the validators to decide the appeal", true,`],
  ["acts", "an appeal lapses at once",
   `      add("lapse_appeal", "Settle on the first ruling", past(a.lapse_at, nowMs),`,
   `      add("lapse_appeal", "Settle on the first ruling", true,`],

  // ── limits ────────────────────────────────────────────────────────────
  ["acts", "a fourth deduction is offered",
   `        open && live < LIMITS.maxDeductions && claimRoom(lease) > 0n,`,
   `        open && claimRoom(lease) > 0n,`],
  ["acts", "a claim is offered when the deposit is fully claimed",
   `        open && live < LIMITS.maxDeductions && claimRoom(lease) > 0n,`,
   `        open && live < LIMITS.maxDeductions,`],
  ["acts", "a seventh notice is offered",
   `      add("notice", "Report a repair", notices < LIMITS.maxNotices,`,
   `      add("notice", "Report a repair", true,`],
  ["acts", "the other side's appeal filings count against you",
   `  return lease.items.filter((it) => it.phase === "APPEAL" && it.role === who && it.kind === kind).length;`,
   `  return lease.items.filter((it) => it.phase === "APPEAL" && it.kind === kind).length;`],
  ["acts", "the landlord's baseline filings use up the tenant's",
   `  return lease.items.some((it) => it.phase === "BASELINE" && it.role === who && it.room_id === roomId && it.kind === kind);`,
   `  return lease.items.some((it) => it.phase === "BASELINE" && it.room_id === roomId && it.kind === kind);`],

  // ── words ─────────────────────────────────────────────────────────────
  ["present", "a date is read in local time",
   "  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;",
   "  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;"],
  ["present", "GEN keeps trailing zeros",
   `  const fracText = frac === 0n ? "" : \`.\${frac.toString().padStart(4, "0").replace(/0+$/, "")}\`;`,
   `  const fracText = frac === 0n ? "" : \`.\${frac.toString().padStart(4, "0")}\`;`],
  ["present", "a typed amount loses its decimals",
   `  return BigInt(w ?? "0") * WEI + BigInt((f + "0".repeat(18)).slice(0, 18));`,
   `  return BigInt(w ?? "0") * WEI;`],
  ["present", "the refusal keeps its machine tag",
   `    .replace(/\\[EXPECTED\\]\\s*/g, "")`,
   `    .replace(/\\[NOTHING\\]\\s*/g, "")`],
  ["present", "an item id reaches the page",
   `      return kind ? \`\${kind === "PHOTO" ? "photograph" : "note"} \${n}\` : \`item \${n}\`;`,
   `      return m;`],
];

const files = { acts: "lib/acts.ts", present: "lib/present.ts" };
const tests = { acts: "tests/acts.test.ts", present: "tests/present.test.ts" };

const [MAJOR, MINOR] = process.versions.node.split(".").map(Number);
const NEEDS_FLAG = MAJOR < 22 || (MAJOR === 22 && MINOR < 12);
// A timezone away from UTC, so a date read in local time differs from one read
// in UTC even on a CI runner whose clock is UTC.
const BASE = { ...process.env, TZ: "Pacific/Auckland" };
const ENV = NEEDS_FLAG
  ? { ...BASE, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-require-module`.trim() }
  : BASE;

function run(testFiles) {
  const r = spawnSync(NODE, [VITEST, "run", ...testFiles.split(" ")], { cwd: WEB, encoding: "utf8", env: ENV });
  const tail = `${r.stdout}${r.stderr}`.match(/Tests\s+[^\n]+/)?.[0] ?? "no summary";
  return { ok: r.status === 0, tail: tail.replace(/\s+/g, " ").trim() };
}

const snapshot = Object.fromEntries(
  Object.values(files).map((f) => [f, readFileSync(join(WEB, f), "utf8")]),
);

let killed = 0;
const survivors = [];
for (const [area, name, from, to] of M) {
  const path = join(WEB, files[area]);
  const original = readFileSync(path, "utf8");
  const count = original.split(from).length - 1;
  if (count !== 1) {
    console.log(`BAD      ${name}: pattern found ${count} times`);
    survivors.push(name);
    continue;
  }
  try {
    writeFileSync(path, original.replace(from, to));
    const r = run(tests[area]);
    if (r.ok) {
      survivors.push(name);
      console.log(`SURVIVED ${name}  (${r.tail})`);
    } else {
      killed++;
      console.log(`killed   ${name}  (${r.tail})`);
    }
  } finally {
    writeFileSync(path, original);
  }
}

const control = run("tests");
console.log(`control, the code as written: ${control.ok ? "passes" : "FAILS"} (${control.tail})`);

const changed = Object.entries(snapshot)
  .filter(([f, text]) => readFileSync(join(WEB, f), "utf8") !== text)
  .map(([f]) => f);
console.log(`files after restore: ${changed.length ? `CHANGED ${changed.join(", ")}` : "as they were"}`);
console.log(`${killed}/${M.length} mutants killed${survivors.length ? `; survivors: ${survivors.join(", ")}` : ""}`);

if (survivors.length || !control.ok || changed.length) process.exit(1);
