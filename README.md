<p align="center"><img src="https://raw.githubusercontent.com/Hemmy1417/LeaseResolve/main/web/public/icon.svg" width="140" alt="LeaseResolve"/></p>

# LeaseResolve - rental deposit arbitration on GenLayer

**A tenant's security deposit held by a contract, and every deduction from it judged against the condition the flat was in on move-in day.**

A landlord and a tenant agree a lease, photograph every room before the tenancy starts, and freeze that record. At move-out the landlord claims deductions, each with a photograph; whatever is not claimed goes back to the tenant at once. Disputed deductions go to GenLayer validators, who each read the stored photographs themselves and must agree on one question per deduction: is this tenant damage? Plain code does the money.

Live app: *(Vercel link added on deploy)*

## What it is

- **A frozen baseline** - both parties photograph each room at move-in; the contract stores the bytes, hashes them, and records a digest of the whole set when check-in closes.
- **Dated repair notices** - the tenant reports problems during the tenancy, stamped with the contract's own clock.
- **Deductions with evidence** - each one names a room, an amount and carries a move-out photograph. The undisputed rest of the deposit is released the moment claims close.
- **A ruling under consensus** - validators read the photographs blind to the claims, then judge; code grounds every finding and pays.
- **One bonded appeal, and nothing that waits forever** - long stops end a ruling or an appeal nobody can obtain. All value leaves through a pull ledger.

## How it works

### For the landlord

1. Offer the lease: the tenant's wallet, the deposit, up to six rooms, the clauses and the rule for fair wear and tear.
2. Photograph and describe each room before the tenant pays.
3. When the tenancy ends, claim up to three deductions, each with a move-out photograph of the room.
4. Close claims: the rest of the deposit goes to the tenant.
5. Ask for a ruling on anything disputed, appeal once if you lost a deduction, then draw what you are owed.

### For the tenant

1. Read the offer and the move-in photographs, then accept and pay the deposit.
2. During check-in, add your own photograph and note for any room (the marks that were already there), then close the baseline.
3. File repair notices as problems happen.
4. At move-out, accept or dispute each deduction, with a statement and optionally a photograph.
5. Ask for a ruling, appeal once if you lost a deduction, then draw what you are owed.

## Findings

| Finding | Meaning | The deduction goes to |
|---|---|---|
| `TENANT_DAMAGE` | Damage beyond fair wear and tear, not there at move-in. Must cite a move-in photograph of the room and a later one, both read. | Landlord |
| `PRE_EXISTING` | The move-in record of the room shows it. Must cite a baseline item of the room. | Tenant |
| `FAIR_WEAR` | Ordinary wear under the lease's own rule. | Tenant |
| `REPORTED_UNREPAIRED` | Reported in a tenant notice and not repaired. Must cite a notice for the room. | Tenant |
| `NOT_SHOWN` | The evidence does not establish the claim. | Tenant |

An ungrounded finding becomes `NOT_SHOWN`. No model ever names an amount: a deduction is paid whole or not at all.

## Lifecycle

```text
OFFERED --accept_lease--> CHECK_IN --confirm_baseline--> TENANCY --end_tenancy--> MOVE_OUT
   |                                                                                  |
cancel_lease                                                                     close_claims
   v                                                                                  v
CANCELLED                  SETTLED <--(nothing disputed)-- RESPONSE --close_responses--+
                              ^                                                       |
                              |                                                AWAITING_RULING
                              |                       request_ruling /                |
                              +---- finalize ---- RULED <-----------------------------+
                              |                     | open_appeal          settle_unresolved (long stop)
                              +-- decide_appeal / lapse_appeal -- APPEALED            |
                              +-------------------------------------------------------+
```

| State | Who acts | Leaves by |
|---|---|---|
| Offered | Landlord files the baseline; tenant accepts | `accept_lease`, `cancel_lease` |
| Check-in | Both add to the baseline | `confirm_baseline` (tenant any time, anyone after the period) |
| Tenancy | Tenant files notices | `end_tenancy` (tenant any time, anyone after the term) |
| Move-out | Landlord claims | `close_claims` (landlord any time, anyone after the period) |
| Response | Tenant answers | `close_responses` (tenant any time, anyone after the period) |
| Awaiting ruling | Either party | `request_ruling`, `settle_unresolved` after the long stop |
| Ruled | The side that lost a deduction | `open_appeal`, `finalize` after the window |
| Appealed | Both file evidence | `decide_appeal` after the evidence period, `lapse_appeal` after its long stop |

## GenLayer consensus functions

| Function | Kind | What runs under consensus |
|---|---|---|
| `request_ruling` | `gl.vm.run_nondet` | Each node reads every stored photograph (two to a prompt, re-read alone if a pair fails), then judges every disputed deduction against the clauses, the baseline, the notices and both sides' words. A validator agrees only when every deduction goes to the same side, and a tenant-damage finding must stand on photographs it read itself. |
| `decide_appeal` | `gl.vm.run_nondet` | The same round on all stored evidence plus what was filed for the appeal; the record marks the new items. |

## Contract

| | |
|---|---|
| Network | GenLayer Studio Next |
| Chain id | 61997 |
| RPC | `https://studio-dev.genlayer.com/api` |
| Explorer | https://explorer-studio-dev.genlayer.com |
| Deployment of record | [`0xe8b8EB695431ef8a87D36027edad860a591fD3FD`](https://explorer-studio-dev.genlayer.com/address/0xe8b8EB695431ef8a87D36027edad860a591fD3FD) |
| Source | [`contracts/leaseresolve.py`](contracts/leaseresolve.py), sha256 `fd6c526ef2f9f015d7ce22666005416f9625c00bff04f7b80c9f869f27b30f63`, verified byte for byte |

### Write methods

| Method | Who | Payable | Notes |
|---|---|---|---|
| `create_lease` | Landlord | | Tenant, deposit, rooms, clauses, wear rule, four windows |
| `cancel_lease` | Landlord | | Only while offered |
| `accept_lease` | Tenant | Yes, the exact deposit | A refusal returns and credits the value back |
| `file_photo` / `file_note` | Either party | | Baseline, notice or appeal evidence, by state and role |
| `confirm_baseline` | Tenant, or anyone after check-in | | Freezes the baseline digest |
| `end_tenancy` | Tenant, or anyone after the term | | Opens the claims period |
| `file_deduction` | Landlord | | Room, description, amount, move-out photograph |
| `withdraw_deduction` | Landlord | | Before claims close it simply goes; after, it pays the tenant |
| `close_claims` | Landlord, or anyone after the period | | Releases the unclaimed deposit |
| `answer_deduction` | Tenant | | Accept (pays the landlord) or dispute |
| `concede_deduction` | Tenant | | Pays the landlord; not while an appeal is pending |
| `close_responses` | Tenant, or anyone after the period | | Unanswered deductions count as accepted |
| `request_ruling` | Either party | | Consensus round |
| `settle_unresolved` | Anyone after the long stop | | Splits each disputed deduction evenly |
| `finalize` | Anyone after the appeal window | | Pays the ruling |
| `open_appeal` | A party the ruling went against | Yes, the exact bond | 5% of what is disputed, at least 0.01 GEN |
| `decide_appeal` | Either party, after the evidence period | | Consensus round; the bond follows what the appeal contested |
| `lapse_appeal` | Anyone after the appeal's long stop | | First ruling stands, bond returned |
| `claim` | Anyone owed | | The only method that sends value |

### Read methods

`get_config`, `get_stats`, `list_leases`, `leases_of`, `get_lease`, `get_round`, `get_item`, `get_item_text`, `get_image`, `get_events`, `get_balance`.

### Consensus guarantees

- Every photograph a round reads is held by the contract and was hashed when filed; every node reads the same bytes, and each round's record lists what it read by digest.
- The reading step is never told what either side claims.
- A tenant-damage finding stands only on a move-in and a later photograph of the same room that the node itself read; the agreed result is grounded again against the contract's own record before it can pay.
- Validators bind who is paid; among the four tenant-side findings the stored label is the leading validator's reading and is marked as not bound.
- A node that read none of a round's photographs does not vote; a photograph a node cannot read shows it nothing and costs only the side that filed it.

## Verified end-to-end

See [`docs/live-proof.md`](docs/live-proof.md): six leases on the deployment of record `0xe8b8EB695431ef8a87D36027edad860a591fD3FD`, every one of the contract's twenty writes sent, each claim an assertion in [`scripts/proofs.mjs`](scripts/proofs.mjs).

Tests: 282 direct-mode tests (including 120 random invariant walks), 75 contract mutants and 27 web mutants all killed, 116 web tests including every composed call checked against the deployment's own schema.

## Tech stack

| Layer | Tools |
|---|---|
| Contract | Python on GenVM, `gl.vm.run_nondet`, `gl.nondet.exec_prompt` with images |
| Tests | pytest direct mode, mutation sweeps, `genvm-lint` |
| App | Next.js 16, React 19, Tailwind 4, genlayer-js 2.0.0-rc.1, Transaction Kit 0.1.0-rc.2 |
| Wallets | EIP-6963 discovery; the selected wallet's provider signs |

## Repository

```text
contracts/leaseresolve.py     the contract
tests/direct/                 direct-mode tests and the stub runtime
tests/mutation/mutate.py      the contract mutation sweep
scripts/                      deploy, keys, schema, live proofs
fixtures/                     the rendered room photographs and how they are drawn
web/                          the app (Vercel root)
docs/                         design, security, live proof
```

## Getting started

```bash
pip install -r requirements.txt
```

```bash
python -m pytest tests/direct -q
```

```bash
cd web && pnpm install && pnpm dev
```

The app reads the deployment of record by default; `NEXT_PUBLIC_LEASERESOLVE_CONTRACT` points it at another deployment and the app says so on every page. The wallet menu offers test GEN from the Studio faucet.

## Security

Five adversarial review rounds ran before the deployment of record; see [`docs/security.md`](docs/security.md) for what each found, what was changed, and the limits that remain.

## Design notes

- The baseline is the product: a deduction is judged against what both parties recorded before any money moved.
- Code, not a model, decides money, grounding and every window.
- The interface never prints machine values outside the verification views.

## Disclaimer

A demonstration on a test network. It is not legal advice and does not replace the law that governs tenancies where you live.
