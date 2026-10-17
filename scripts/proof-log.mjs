/**
 * Turn a finished live run (.data/proofs-<address>.json) into the committed
 * proof documents: docs/proof-run.txt (every transaction, in order) and
 * docs/live-proof.md (what each lease proved, with its assertions).
 *
 *   node scripts/proof-log.mjs 0x…
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADDRESS = process.argv[2];
const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const run = JSON.parse(readFileSync(at(`../.data/proofs-${ADDRESS}.json`), "utf-8"));
if (!run.finished_at) throw new Error("that run has not finished");

const steps = Object.values(run.steps);
const lines = [
  `LeaseResolve live proof on GenLayer Studio Next (chain 61997)`,
  `contract ${run.address}`,
  `finished ${run.finished_at}: ${run.checks} checks, ${steps.length} transactions, `
    + `${(run.no_consensus ?? []).length} rounds without a majority`,
  "",
];
for (const s of steps) {
  const what = s.ok ? "ok      " : "refused ";
  lines.push(`${what}${s.name.padEnd(28)} ${s.role.padEnd(9)} ${s.fn.padEnd(19)} ${s.hash}`);
  if (!s.ok) lines.push(`         ${s.text.replace(/\s+/g, " ").slice(0, 160)}`);
  if (s.fn === "request_ruling" || s.fn === "decide_appeal") {
    for (const d of s.returned?.deductions ?? []) lines.push(`         ${d.id}: ${d.finding} -> ${d.to}`);
    if (s.returned?.result) lines.push(`         appeal ${s.returned.result}`);
  }
}
if (run.no_consensus?.length) {
  lines.push("", "rounds without a majority (nothing recorded; asked again):");
  for (const n of run.no_consensus) lines.push(`  ${n.name} ${n.hash}`);
}
lines.push("", "observed (not asserted):", ...run.observed.map((o) => `  ${o}`));
writeFileSync(at("../docs/proof-run.txt"), `${lines.join("\n")}\n`);

const link = (s) => `[${s.name}](${s.explorer})`;
const by = (prefix) => steps.filter((s) => s.name.startsWith(prefix));
const md = [
  "# Live proof",
  "",
  `Run by \`scripts/proofs.mjs\` on the deployment of record \`${run.address}\`, GenLayer Studio Next, finished ${run.finished_at}.`,
  `${run.checks} assertions passed across ${steps.length} transactions; ${(run.no_consensus ?? []).length} rounds had no majority and were asked again (nothing is recorded by such a round). The full transaction list is in [proof-run.txt](proof-run.txt).`,
  "",
  "Every claim below is an assertion in the script: had the contract or the validators done otherwise, the run would have stopped there. What the validators were free to decide either way is listed separately as observed.",
  "",
  "| Lease | What it proves | Transactions |",
  "|---|---|---|",
];
const ROWS = [
  ["A", "Three disputed deductions on rendered move-in and move-out photographs. Holes and a stain absent at move-in found tenant damage (paid to the landlord); a chip the tenant's own move-in photograph shows returned to the tenant. A wrong deposit and a wrong bond refused in words and credited back; a concession refused under appeal; the appeal's record marks its two new notes; the bond follows the contested deduction; every wei accounted for."],
  ["B", "A withdrawn claim asks for nothing; an accepted deduction pays the landlord; with nothing disputed the lease settles without a ruling."],
  ["C", "A ruling, a concession after it, settlement refused inside the appeal window and paid after it."],
  ["D", "An offer withdrawn before any deposit; the tenant cannot withdraw it; a late acceptance is refused and credited back."],
  ["E", "Settlement refused before the long stop; after it, the disputed deduction split evenly with the odd wei to the tenant."],
  ["F", "An appeal nobody decides lapses after its long stop: the first ruling settles the lease and the bond goes back."],
];
for (const [k, t] of ROWS) md.push(`| ${k} | ${t} | ${by(`${k}.`).map(link).join(", ")} |`);
const tail = [
  "",
  "Both parties then drew what they were owed with `claim`; each ledger read zero afterwards and each wallet's balance rose.",
  "",
  "## Observed, not asserted",
  "",
  ...run.observed.map((o) => `- ${o}`),
  "",
];
writeFileSync(at("../docs/live-proof.md"), [...md, ...tail].join("\n"));
console.log(`wrote docs/proof-run.txt and docs/live-proof.md (${steps.length} transactions)`);
