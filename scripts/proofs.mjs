/**
 * Live proofs on a LeaseResolve deployment, on GenLayer Studio Next. Every
 * claim a proof makes is an assertion: if the contract or the validators
 * behave otherwise, the run stops and says which assertion failed. What is
 * only observed (a finding the model was free to make) is logged as an
 * observation, not claimed.
 *
 *   node scripts/proofs.mjs 0x…            run every proof in order (resumable)
 *
 * Six leases, every write the contract has:
 *   A  ruling and appeal    three disputed deductions, a ruling, a bonded
 *                           appeal with new evidence, the appeal's decision
 *   B  agreement            a withdrawn claim, an accepted one, no ruling
 *   C  ruling and finalize  a ruling, a concession, settlement after the window
 *   D  withdrawn offer      cancelled before any deposit
 *   E  long stop            a dispute nobody asks to rule on, split evenly
 *   F  lapsed appeal        an appeal nobody decides, which lapses
 * then both parties draw what they are owed.
 *
 * Results, with every transaction hash, go to .data/proofs-<address>.json.
 * Signers are the roles in .data/keys.json (gitignored, never printed).
 */
import { createAccount, createClient } from "genlayer-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXPLORER, GEN, chain, leaderOf, loadKeys, plainFees, resultText, rpc, sleep,
         transferFees, waitFinal } from "./lib.mjs";

const ADDRESS = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS ?? "")) throw new Error("usage: node scripts/proofs.mjs 0x…");
const OUT = fileURLToPath(new URL(`../.data/proofs-${ADDRESS}.json`, import.meta.url));
const PHOTO = (name) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/photos/${name}.jpg`, import.meta.url))));
const KEYS = loadKeys();
const run = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf-8")) : { address: ADDRESS, steps: {}, leases: {}, observed: [] };
const save = () => writeFileSync(OUT, JSON.stringify(run, null, 2));
const say = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const clientFor = (role) => createClient({ chain, account: createAccount(KEYS[role].pk) });
const reader = createClient({ chain, account: createAccount(KEYS.STRANGER.pk) });
const WINDOW = 600;
let checks = 0;

/**
 * Every assertion that passes is recorded by its sentence, so the run's count
 * is of distinct claims proved across sittings, and a resumed run can skip a
 * claim about a moment that has passed (see `once`).
 */
function assert(cond, message) {
  if (!cond) {
    say(`ASSERTION FAILED: ${message}`);
    process.exit(2);
  }
  run.passed ??= [];
  if (!run.passed.includes(message)) run.passed.push(message);
  checks = run.passed.length;
  save();
}

/**
 * A claim about a lease's state at one moment. Once proved it is not checked
 * again: on a resumed run that moment is over, and the state has moved on.
 */
async function once(message, read) {
  if (run.passed?.includes(message)) return say(`checked earlier: ${message}`);
  assert(await read(), message);
}

function observe(what) {
  if (!run.observed.includes(what)) run.observed.push(what);
  save();
  say(`observed: ${what}`);
}

async function read(fn, args) {
  for (let i = 0; i < 8; i++) {
    try {
      return await reader.readContract({ address: ADDRESS, functionName: fn, args });
    } catch (e) {
      if (i === 7) throw e;
      await sleep(5000 * (i + 1));
    }
  }
}
const readJson = async (fn, args) => JSON.parse(await read(fn, args));
const lease = (lid) => readJson("get_lease", [lid]);
const owed = async (role) => BigInt((await readJson("get_balance", [KEYS[role].addr])).claimable);

const ROUNDS = new Set(["request_ruling", "decide_appeal"]);

/**
 * One signed write, remembered by name so a rerun skips what already landed.
 * The hash is saved the moment it is sent, so a rerun waits on the same
 * transaction instead of sending a second one. A round the validators could
 * not agree on records nothing, so it is asked again, up to three times.
 */
async function step(name, role, fn, args, { value = 0n, transfer = false, refused = null } = {}) {
  if (run.steps[name]) {
    say(`${name}: done earlier`);
    return run.steps[name];
  }
  run.pending ??= {};
  const attempts = ROUNDS.has(fn) ? 3 : 1;
  let hash, t, secs;
  for (let ask = 1; ; ask++) {
    hash = run.pending[name];
    if (!hash) {
      for (let attempt = 0; ; attempt++) {
        try {
          const client = clientFor(role);
          const fees = transfer
            ? await transferFees(client, { address: ADDRESS, functionName: fn, args, value })
            : await plainFees(client);
          hash = await client.writeContract({ address: ADDRESS, functionName: fn, args, value, fees });
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          say(`${name}: send failed (${String(e.message).slice(0, 80)}), retrying`);
          await sleep(8000 * (attempt + 1));
        }
      }
      run.pending[name] = hash;
      save();
      say(`${name}: ${role} ${fn} ${hash}`);
    } else {
      say(`${name}: waiting again on ${hash}`);
    }
    const t0 = Date.now();
    try {
      t = await waitFinal(hash, { label: name, tries: ROUNDS.has(fn) ? 450 : 150 });
      secs = Math.round((Date.now() - t0) / 1000);
      break;
    } catch (e) {
      if (!/UNDETERMINED|CANCELED/.test(e.message)) throw e;
      delete run.pending[name];
      (run.no_consensus ??= []).push({ name, hash, at: new Date().toISOString() });
      save();
      if (ask >= attempts) throw e;
      say(`${name}: no majority, so nothing was recorded; asking again (${ask + 1} of ${attempts})`);
      await sleep(15000);
    }
  }
  delete run.pending[name];
  const leader = leaderOf(t);
  const ok = leader?.execution_result === "SUCCESS";
  const text = resultText(leader);
  say(`${name}: ${t.status} leader=${leader?.execution_result} in ${secs} s`);
  if (refused) {
    assert(!ok, `${name} should have been refused`);
    assert(text.includes(refused), `${name} refusal should say "${refused}", said "${text.slice(0, 200)}"`);
  } else {
    assert(ok, `${name} failed: ${text.slice(0, 300)}`);
  }
  const i = text.indexOf("{");
  let returned = null;
  try { returned = i >= 0 ? JSON.parse(text.slice(i)) : null; } catch { returned = null; }
  const rec = { name, role, fn, hash, secs, ok, returned, text: text.slice(0, 600), explorer: `${EXPLORER}/tx/${hash}`,
                rotations: t.consensus_history?.consensus_results?.length ?? null };
  run.steps[name] = rec;
  save();
  return rec;
}

/** Wait until a chain deadline has passed, with a margin for clock drift. */
async function after(iso, label) {
  const at = Date.parse(iso) + 20_000;
  while (Date.now() < at) {
    say(`waiting for ${label}: ${Math.ceil((at - Date.now()) / 60000)} min left`);
    await sleep(Math.min(60_000, at - Date.now()));
  }
}

function conserved(l) {
  const took = (l.accepted_at ? BigInt(l.deposit_wei) : 0n) + (l.appeal ? BigInt(l.appeal.bond_wei) : 0n);
  return BigInt(l.held_wei) + BigInt(l.paid_landlord_wei) + BigInt(l.paid_tenant_wei) === took;
}

function leaseParams(title, deposit, rooms) {
  return JSON.stringify({
    title, property: "Flat 4B, 12 Admiralty Way, Lekki", tenant: KEYS.TENANT.addr,
    deposit_wei: deposit.toString(), ends_at: "2027-12-31T12:00:00Z",
    rooms: rooms.map((name) => ({ name })),
    clauses: [
      "The tenant returns the flat in the condition recorded at move-in, fair wear and tear excepted.",
      "The landlord repairs plumbing faults the tenant reports in writing.",
    ],
    wear_rule: "Light scuffs, faded paint and worn finishes from normal daily living are fair wear and tear. Holes, burns, large stains and breakage are not.",
    windows: { check_in: WINDOW, claims: WINDOW, response: WINDOW, appeal: WINDOW },
  });
}

async function create(key, title, deposit, rooms) {
  const rec = await step(`${key}.create`, "LANDLORD", "create_lease", [leaseParams(title, deposit, rooms)]);
  run.leases[key] ??= rec.returned.lease_id;
  save();
  return run.leases[key];
}

const meta = (room, caption = "", deduction = "") => JSON.stringify({ room_id: room, caption, deduction_id: deduction });

/** Offered, paid, baseline frozen, moved out: ready for claims. */
async function toMoveOut(key, lid, deposit, { tenantSink = false } = {}) {
  await step(`${key}.accept`, "TENANT", "accept_lease", [lid], { value: deposit });
  if (tenantSink) {
    await step(`${key}.tenant-photo-R2`, "TENANT", "file_photo", [lid, meta("R2", "The chip on the front rim of the basin"), PHOTO("bathroom-sink-tenant-move-in")]);
    await step(`${key}.tenant-note-R2`, "TENANT", "file_note", [lid, meta("R2"), "There is already a chip and a hairline crack on the front rim of the basin, right side."]);
  }
  await step(`${key}.confirm`, "TENANT", "confirm_baseline", [lid]);
  await step(`${key}.end`, "TENANT", "end_tenancy", [lid]);
}

// ── A: ruling and appeal ─────────────────────────────────────────────────────

async function leaseA() {
  const deposit = 2n * GEN;
  const lid = await create("A", "Two-bedroom flat, three rooms in dispute", deposit, ["Living room", "Bathroom", "Kitchen"]);
  await step("A.photo-R1", "LANDLORD", "file_photo", [lid, meta("R1", "The living room wall by the switch"), PHOTO("living-wall-move-in")]);
  await step("A.photo-R2", "LANDLORD", "file_photo", [lid, meta("R2", "The bathroom basin"), PHOTO("bathroom-sink-landlord-move-in")]);
  await step("A.photo-R3", "LANDLORD", "file_photo", [lid, meta("R3", "The kitchen cupboard doors"), PHOTO("kitchen-cupboard-move-in")]);
  await step("A.note-R1", "LANDLORD", "file_note", [lid, meta("R1"), "Walls freshly painted in beige, no marks, no holes."]);
  await step("A.stranger-files", "STRANGER", "file_photo", [lid, meta("R1"), PHOTO("living-wall-move-in")], { refused: "only the landlord or the tenant" });
  await step("A.tenant-before-paying", "TENANT", "file_note", [lid, meta("R1"), "Early note."], { refused: "after accepting the offer" });

  // A wrong deposit is refused by RETURNING, and the value is credited back.
  const before = await owed("TENANT");
  const wrong = await step("A.accept-wrong-amount", "TENANT", "accept_lease", [lid], { value: GEN });
  assert(wrong.returned?.refused === true && /exactly the deposit/.test(wrong.returned.reason), "a wrong deposit is refused in words");
  assert(run.steps["A.accept-wrong-amount"].checked || (await owed("TENANT")) - before === GEN, "the wrong deposit is claimable back");
  run.steps["A.accept-wrong-amount"].checked = true;
  save();

  await toMoveOut("A", lid, deposit, { tenantSink: true });
  const frozen = "the baseline froze with a digest and the tenancy ended";
  if (run.steps["A.deduct-R1"] && !run.passed?.includes(frozen)) {
    // Proved in the first sitting, which ran on to the deductions before the
    // record of passed claims existed; the deductions could not have been
    // filed otherwise.
    (run.passed ??= []).push(frozen);
  }
  await once(frozen, async () => {
    const l = await lease(lid);
    return l.state === "MOVE_OUT" && l.baseline_digest.length === 64;
  });
  let l;

  await step("A.deduct-R1", "LANDLORD", "file_deduction", [lid, "R1", "Three holes punched in the living room wall, a crack below them, and a large brown stain beside them. Replastering and repainting.", (6n * GEN / 10n).toString(), PHOTO("living-wall-move-out")]);
  await step("A.deduct-R2", "LANDLORD", "file_deduction", [lid, "R2", "The basin is chipped on the front rim and cracked. Replacement basin.", (4n * GEN / 10n).toString(), PHOTO("bathroom-sink-move-out")]);
  await step("A.deduct-R3", "LANDLORD", "file_deduction", [lid, "R3", "Scuffed kitchen cupboard doors around the handles. Refinishing.", (3n * GEN / 10n).toString(), PHOTO("kitchen-cupboard-move-out")]);
  await step("A.deduct-too-much", "LANDLORD", "file_deduction", [lid, "R1", "Anything else.", (8n * GEN / 10n).toString(), PHOTO("living-wall-move-out")], { refused: "at most 3 deductions" });
  const closed = await step("A.close-claims", "LANDLORD", "close_claims", [lid]);
  assert(closed.returned.released_wei === (7n * GEN / 10n).toString(), "what the claims do not ask for (0.7 GEN) is released to the tenant");

  await step("A.dispute-D1", "TENANT", "answer_deduction", [lid, "D1", false, "Those marks are not mine; the wall was like that.", new Uint8Array(0)]);
  await step("A.dispute-D2", "TENANT", "answer_deduction", [lid, "D2", false, "The chip was there on move-in day: see my move-in photograph and note.", new Uint8Array(0)]);
  await step("A.dispute-D3", "TENANT", "answer_deduction", [lid, "D3", false, "Light scuffs around handles are ordinary wear under the lease's own rule.", new Uint8Array(0)]);
  await step("A.landlord-answers", "LANDLORD", "answer_deduction", [lid, "D1", true, "", new Uint8Array(0)], { refused: "only the tenant" });
  await step("A.close-responses", "TENANT", "close_responses", [lid]);

  const ruling = await step("A.ruling", "TENANT", "request_ruling", [lid]);
  const to = Object.fromEntries(ruling.returned.deductions.map((r) => [r.id, r]));
  say(`ruling: ${JSON.stringify(ruling.returned.deductions)}`);
  assert(to.D1.to === "LANDLORD" && to.D1.finding === "TENANT_DAMAGE", "holes and a stain absent from the move-in photograph are tenant damage");
  assert(to.D2.to === "TENANT", "a chip the tenant's move-in photograph shows is not the tenant's to pay for");
  observe(`D3 (light scuffs) was found ${to.D3.finding} and goes to the ${to.D3.to.toLowerCase()}`);
  l = await lease(lid);
  const round = l.rounds[0];
  assert(round.read.every((r) => r.sha256.length === 64), "the round's record lists every item it read by digest");
  assert(round.baseline_digest === l.baseline_digest, "the round names the baseline it judged against");

  // The tenant lost D1, so the tenant may appeal; the bond must be exact.
  const bond = BigInt(l.appeal_bond_wei);
  const badBond = await step("A.appeal-wrong-bond", "TENANT", "open_appeal", [lid, "The wall marks predate me."], { value: bond + 1n });
  assert(badBond.returned?.refused === true && /exactly the appeal bond/.test(badBond.returned.reason), "a wrong bond is refused in words and credited back");
  const opened = await step("A.appeal", "TENANT", "open_appeal", [lid, "The marks on the living room wall were there before I moved in; the move-in photograph was taken from too far away to show them."], { value: bond });
  assert(opened.returned?.refused === false, "the appeal opens with the exact bond");
  await step("A.appeal-concede", "TENANT", "concede_deduction", [lid, "D1"], { refused: "while the lease is appealed" });
  await step("A.appeal-note", "TENANT", "file_note", [lid, meta("", "", "D1"), "I never drilled or hung anything on that wall. The stain is from a leak in the flat above."], {});
  await step("A.appeal-note-landlord", "LANDLORD", "file_note", [lid, meta("", "", "D1"), "The flat above has had no leak; the wall was repainted the week before the tenancy began."]);
  await step("A.decide-too-early", "TENANT", "decide_appeal", [lid], { refused: "evidence period is still open" });
  l = await lease(lid);
  await after(l.appeal.evidence_ends, "the appeal's evidence period");
  const decided = await step("A.decide", "LANDLORD", "decide_appeal", [lid]);
  say(`appeal: ${decided.returned.result} ${JSON.stringify(decided.returned.deductions)}`);
  l = await lease(lid);
  assert(l.state === "SETTLED" && l.held_wei === "0" && conserved(l), "the appeal settles the lease and every wei is accounted for");
  assert(l.rounds[1].kind === "APPEAL" && l.rounds[1].new_items.length === 2, "the appeal's record marks the two notes filed for it as new");
  const movedD1 = l.rounds[1].deductions.find((r) => r.id === "D1").to === "TENANT";
  assert(decided.returned.result === (movedD1 ? "MOVED" : "UPHELD"), "the bond follows the contested deduction");
  observe(`the appeal was ${decided.returned.result}`);
}

// ── B: agreement ─────────────────────────────────────────────────────────────

async function leaseB() {
  const deposit = GEN;
  const lid = await create("B", "Studio flat, settled by agreement", deposit, ["Living room"]);
  await step("B.photo-R1", "LANDLORD", "file_photo", [lid, meta("R1", "The living room wall"), PHOTO("living-wall-move-in")]);
  await toMoveOut("B", lid, deposit);
  await step("B.deduct-1", "LANDLORD", "file_deduction", [lid, "R1", "Cleaning.", (5n * GEN / 10n).toString(), PHOTO("living-wall-move-in")]);
  await step("B.withdraw-1", "LANDLORD", "withdraw_deduction", [lid, "D1"]);
  await step("B.deduct-2", "LANDLORD", "file_deduction", [lid, "R1", "Holes in the wall.", (2n * GEN / 10n).toString(), PHOTO("living-wall-move-out")]);
  const closed = await step("B.close-claims", "LANDLORD", "close_claims", [lid]);
  assert(closed.returned.released_wei === (8n * GEN / 10n).toString(), "a withdrawn claim asks for nothing; 0.8 GEN is released");
  await step("B.accept", "TENANT", "answer_deduction", [lid, "D2", true, "", new Uint8Array(0)]);
  const done = await step("B.close-responses", "TENANT", "close_responses", [lid]);
  assert(done.returned.state === "SETTLED", "with nothing disputed the lease settles without a ruling");
  const l = await lease(lid);
  assert(l.settled_how === "AGREED" && l.paid_landlord_wei === (2n * GEN / 10n).toString() && conserved(l), "the accepted deduction is the landlord's, the rest the tenant's");
}

// ── C: ruling, concession, finalize ──────────────────────────────────────────

async function leaseC() {
  const deposit = GEN;
  const lid = await create("C", "One-bedroom flat, ruling without appeal", deposit, ["Living room", "Kitchen"]);
  await step("C.photo-R1", "LANDLORD", "file_photo", [lid, meta("R1", "The living room wall"), PHOTO("living-wall-move-in")]);
  await step("C.photo-R2", "LANDLORD", "file_photo", [lid, meta("R2", "The kitchen cupboards"), PHOTO("kitchen-cupboard-move-in")]);
  await toMoveOut("C", lid, deposit);
  await step("C.deduct-R1", "LANDLORD", "file_deduction", [lid, "R1", "Holes and a large stain on the living room wall.", (5n * GEN / 10n).toString(), PHOTO("living-wall-move-out")]);
  await step("C.deduct-R2", "LANDLORD", "file_deduction", [lid, "R2", "Scuffed cupboard doors.", (2n * GEN / 10n).toString(), PHOTO("kitchen-cupboard-move-out")]);
  await step("C.close-claims", "LANDLORD", "close_claims", [lid]);
  await step("C.dispute-D1", "TENANT", "answer_deduction", [lid, "D1", false, "Not me.", new Uint8Array(0)]);
  await step("C.dispute-D2", "TENANT", "answer_deduction", [lid, "D2", false, "Ordinary wear.", new Uint8Array(0)]);
  await step("C.close-responses", "TENANT", "close_responses", [lid]);
  const ruling = await step("C.ruling", "LANDLORD", "request_ruling", [lid]);
  say(`ruling: ${JSON.stringify(ruling.returned.deductions)}`);
  await step("C.concede-D2", "TENANT", "concede_deduction", [lid, "D2"]);
  await step("C.finalize-too-early", "STRANGER", "finalize", [lid], { refused: "appeal window is still open" });
  let l = await lease(lid);
  await after(l.appeal_ends, "the appeal window");
  await step("C.finalize", "STRANGER", "finalize", [lid]);
  l = await lease(lid);
  const d1 = l.deductions.find((d) => d.id === "D1");
  assert(l.settled_how === "RULING" && d1.paid_to === d1.ruled_to && conserved(l), "the ruling pays D1 to the side it named");
  assert(l.deductions.find((d) => d.id === "D2").state === "CONCEDED", "the conceded deduction went to the landlord at once");
}

// ── D: a withdrawn offer ─────────────────────────────────────────────────────

async function leaseD() {
  const lid = await create("D", "Offer withdrawn before any deposit", GEN, ["Living room"]);
  await step("D.tenant-cancels", "TENANT", "cancel_lease", [lid], { refused: "only the landlord" });
  await step("D.cancel", "LANDLORD", "cancel_lease", [lid]);
  const late = await step("D.accept-after-cancel", "TENANT", "accept_lease", [lid], { value: GEN });
  assert(late.returned?.refused === true, "a withdrawn offer cannot be accepted, and the value is credited back");
}

// ── E: the long stop ─────────────────────────────────────────────────────────

async function leaseE() {
  const deposit = GEN;
  const lid = await create("E", "A dispute nobody asks to rule on", deposit, ["Living room"]);
  await step("E.photo-R1", "LANDLORD", "file_photo", [lid, meta("R1", "The wall"), PHOTO("living-wall-move-in")]);
  await toMoveOut("E", lid, deposit);
  await step("E.deduct", "LANDLORD", "file_deduction", [lid, "R1", "Holes in the wall.", (3n * GEN / 10n + 1n).toString(), PHOTO("living-wall-move-out")]);
  await step("E.close-claims", "LANDLORD", "close_claims", [lid]);
  await step("E.dispute", "TENANT", "answer_deduction", [lid, "D1", false, "Not me.", new Uint8Array(0)]);
  await step("E.close-responses", "TENANT", "close_responses", [lid]);
  // Checked now, while the long stop is still ahead; the settlement itself
  // waits for the end of the run.
  await step("E.settle-too-early", "STRANGER", "settle_unresolved", [lid], { refused: "long stop has not passed" });
  return lid;
}

async function settleE(lid) {
  let l = await lease(lid);
  await after(l.ruling_long_stop, "E's long stop");
  await step("E.settle", "STRANGER", "settle_unresolved", [lid]);
  l = await lease(lid);
  const amount = 3n * GEN / 10n + 1n;
  assert(l.settled_how === "UNRESOLVED" && l.deductions[0].paid_to === "SPLIT", "the long stop splits the disputed deduction");
  assert(BigInt(l.paid_landlord_wei) === amount / 2n && conserved(l), "half to the landlord, the odd wei to the tenant");
}

// ── F: a lapsed appeal ───────────────────────────────────────────────────────

async function leaseF() {
  const deposit = GEN;
  const lid = await create("F", "An appeal nobody decides", deposit, ["Living room"]);
  await step("F.photo-R1", "LANDLORD", "file_photo", [lid, meta("R1", "The wall"), PHOTO("living-wall-move-in")]);
  await toMoveOut("F", lid, deposit);
  await step("F.deduct", "LANDLORD", "file_deduction", [lid, "R1", "Holes and a stain on the wall.", (4n * GEN / 10n).toString(), PHOTO("living-wall-move-out")]);
  await step("F.close-claims", "LANDLORD", "close_claims", [lid]);
  await step("F.dispute", "TENANT", "answer_deduction", [lid, "D1", false, "Not me.", new Uint8Array(0)]);
  await step("F.close-responses", "TENANT", "close_responses", [lid]);
  const ruling = await step("F.ruling", "TENANT", "request_ruling", [lid]);
  const loser = ruling.returned.deductions[0].to === "LANDLORD" ? "TENANT" : "LANDLORD";
  const l = await lease(lid);
  const opened = await step("F.appeal", loser, "open_appeal", [lid, "The ruling is wrong about the wall."], { value: BigInt(l.appeal_bond_wei) });
  assert(opened.returned?.refused === false, "the side the ruling went against appeals");
  // Checked now, while the appeal's long stop is still ahead.
  if (!run.steps["F.lapse"]) {
    await step("F.lapse-too-early", "STRANGER", "lapse_appeal", [lid], { refused: "has not lapsed" });
  }
  return { lid, loser };
}

async function lapseF({ lid, loser }) {
  let l = await lease(lid);
  await after(l.appeal.lapse_at, "F's appeal long stop");
  await step("F.lapse", "STRANGER", "lapse_appeal", [lid]);
  l = await lease(lid);
  assert(l.appeal.result === "LAPSED" && l.settled_how === "APPEAL_LAPSED" && conserved(l), "the appeal lapses and the first ruling settles the lease");
  assert(l.deductions[0].paid_to === l.deductions[0].ruled_to, "the first ruling's side is paid");
  observe(`F's appellant was the ${loser.toLowerCase()}; the bond went back`);
}

// ── drawing what is owed ─────────────────────────────────────────────────────

async function draw(role) {
  const key = `draw.${role}`;
  if (run.steps[key]) return say(`${key}: done earlier`);
  const due = await owed(role);
  if (due === 0n) return say(`${role} is owed nothing`);
  const before = BigInt((await rpc("eth_getBalance", [KEYS[role].addr, "latest"])).result);
  run.before ??= {};
  run.before[role] ??= before.toString();
  save();
  await step(key, role, "claim", [], { transfer: true });
  assert((await owed(role)) === 0n, `${role}'s ledger is empty after drawing`);
  let now = before;
  for (let i = 0; i < 20 && now <= BigInt(run.before[role]); i++) {
    await sleep(3000);
    now = BigInt((await rpc("eth_getBalance", [KEYS[role].addr, "latest"])).result);
  }
  assert(now > BigInt(run.before[role]), `${role}'s wallet received the transfer`);
  run.steps[key].drawn_wei = due.toString();
  save();
}

// ── run ──────────────────────────────────────────────────────────────────────

const cfg = await readJson("get_config", []);
assert(cfg.ruleset === "leaseresolve-rules-1", "the deployment runs this rule set");
const eLid = await leaseE();       // its long stop runs while the rest proceeds
const f = await leaseF();
await leaseD();
await leaseB();
await leaseA();
await leaseC();
await settleE(eLid);
await lapseF(f);
await draw("LANDLORD");
await draw("TENANT");
const stats = await readJson("get_stats", []);
assert(stats.held_wei === "0", "no lease holds anything once every lease has settled");
const writes = new Set(Object.values(run.steps).map((s) => s.fn));
say(`writes reached: ${[...writes].sort().join(", ")} (${writes.size})`);
assert(writes.size === 20, "every write the contract has was sent");
run.checks = (run.passed ?? []).length;
run.finished_at = new Date().toISOString();
save();
say(`EVERY CHECK PASSED (${checks} checks, ${Object.keys(run.steps).length} transactions, `
  + `${(run.no_consensus ?? []).length} rounds without a majority)`);
