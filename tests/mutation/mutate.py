"""Mutation check: break each rule of contracts/leaseresolve.py and prove the
direct suite fails, then prove the unbroken contract passes.

Run from the repo root:  python tests/mutation/mutate.py
Name some words to run only the mutants whose description contains one of
them:  python tests/mutation/mutate.py appeal ground
Exit status 0 only if every mutant is killed and the control passes. The
sweep works on a temporary copy of contracts/ and tests/, so the repository's
own files are never touched. A rule guarded in two places is broken in both at
once (a list of replacements), or one of the mutants would be equivalent and
report a false pin.

The random walks in test_invariants run with fewer seeds here
(LEASERESOLVE_WALK_SEEDS); every other test runs in full.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
TEXT = (REPO / "contracts" / "leaseresolve.py").read_text(encoding="utf-8")

# Left out on purpose, each an equivalent mutant (breaking it changes nothing a
# test could see): the overpay guard in _pay (no money path asks a lease for
# more than it holds), the validator's blind-leader check (a blind leader
# returns no findings, which _unconfirmed already refuses), and the guard
# against a later failed reading overwriting a read one (a read photograph is
# in `seen`, so the branch only ever re-records a reading that read).
MUTATIONS = [
    # ── grounding: damage is a change, and a change needs a before ──────────
    ("damage needs no move-in photograph",
     '        return finding if before and after else "NOT_SHOWN"', '        return finding if after else "NOT_SHOWN"'),
    ("damage needs no later photograph",
     '        return finding if before and after else "NOT_SHOWN"', '        return finding if before else "NOT_SHOWN"'),
    ("a photograph of another room grounds damage",
     '    cited = [meta[e] for e in basis if e in meta and meta[e]["room_id"] == room_id]',
     '    cited = [meta[e] for e in basis if e in meta]'),
    ("an unread photograph grounds damage",
     '        return it["kind"] == "PHOTO" and it["item_id"] in read',
     '        return it["kind"] == "PHOTO"'),
    ("a note stands in for a move-in photograph",
     '        before = any(seen(it) and it["phase"] == "BASELINE" for it in cited)',
     '        before = any((seen(it) or it["kind"] == "NOTE") and it["phase"] == "BASELINE" for it in cited)'),
    ("pre-existing needs no baseline item",
     '        return finding if ok else "NOT_SHOWN"\n    if finding == "REPORTED_UNREPAIRED":',
     '        return finding\n    if finding == "REPORTED_UNREPAIRED":'),
    ("reported-unrepaired needs no notice",
     '        ok = any(it["phase"] == "NOTICE" for it in cited)', '        ok = True'),

    # ── the money: only tenant damage keeps a deduction ─────────────────────
    ("fair wear pays the landlord",
     '    return "LANDLORD" if finding == "TENANT_DAMAGE" else "TENANT"',
     '    return "LANDLORD" if finding in ("TENANT_DAMAGE", "FAIR_WEAR") else "TENANT"'),
    ("the release ignores the claims",
     '        released = int(lease["deposit_wei"]) - sum(int(d["amount_wei"]) for d in live)',
     '        released = int(lease["deposit_wei"])'),
    ("an accepted deduction pays the tenant",
     '            self._give(lease, d, "LANDLORD", "ACCEPTED")\n            self._save(lease)',
     '            self._give(lease, d, "TENANT", "ACCEPTED")\n            self._save(lease)'),
    ("an unanswered deduction is returned instead of accepted",
     '            if d["state"] == "CLAIMED":\n                self._give(lease, d, "LANDLORD", "ACCEPTED")',
     '            if d["state"] == "CLAIMED":\n                self._give(lease, d, "TENANT", "ACCEPTED")'),
    ("a withdrawal after claims close pays nobody",
     '            self._give(lease, d, "TENANT", "WITHDRAWN")', '            d["state"] = "WITHDRAWN"'),
    ("a concession pays the tenant",
     '        self._give(lease, d, "LANDLORD", "CONCEDED")', '        self._give(lease, d, "TENANT", "CONCEDED")'),
    ("claims may exceed the deposit",
     '        if amount + sum(int(d["amount_wei"]) for d in live) > int(lease["deposit_wei"]):',
     '        if False:'),
    ("the long stop pays the landlord whole",
     '            landlord = int(d["amount_wei"]) // 2', '            landlord = int(d["amount_wei"])'),
    ("the odd wei goes to the landlord",
     '            landlord = int(d["amount_wei"]) // 2', '            landlord = (int(d["amount_wei"]) + 1) // 2'),
    ("claim pays without zeroing first",
     '        row["claimable"] = "0"\n        row["claimed"]', '        row["claimed"]'),

    # ── consensus ───────────────────────────────────────────────────────────
    ("validators need not agree on who is paid",
     '        if _payee(theirs.get(did)) != _payee(mine.get(did)) or theirs.get(did) not in FINDINGS:',
     '        if theirs.get(did) not in FINDINGS:'),
    ("validators must agree on the exact label",
     '        if _payee(theirs.get(did)) != _payee(mine.get(did)) or theirs.get(did) not in FINDINGS:',
     '        if theirs.get(did) != mine.get(did) or theirs.get(did) not in FINDINGS:'),
    ("a leader's damage need not stand on what the validator saw",
     '                or _unsupported(theirs, ctx, set(mine["read"]))', '                or ""'),
    ("every tenant-side basis must stand on what the validator saw",
     '        if theirs["findings"].get(d["id"]) != "TENANT_DAMAGE":\n            continue',
     '        if False:\n            continue'),
    ("a blind validator votes",
     '            if not mine["images_received"]:\n                print("[DISAGREE] this validator did not read',
     '            if False:\n                print("[DISAGREE] this validator did not read'),
    ("an agreed result is not checked before it pays",
     '        return self._checked(result, ctx)', '        return {"rows": [{"id": d["id"], "room_id": d["room_id"], "finding": result["findings"][d["id"]], "finding_bound": True, "to": _payee(result["findings"][d["id"]]), "amount_wei": d["amount_wei"], "basis": [], "note": ""} for d in ctx["disputed"]], "reasoning": ""}'),
    ("an agreed ungrounded damage finding pays",
     '            if _ground(f, cited, d["room_id"], ctx["meta"], read) != f:\n                raise gl.vm.UserError(bad)',
     '            if False:\n                raise gl.vm.UserError(bad)'),
    ("a blind consensus result pays",
     '        if not isinstance(result, dict) or result.get("images_received") is not True \\',
     '        if not isinstance(result, dict) \\'),
    ("an unknown finding pays",
     '            if f not in FINDINGS:\n                raise gl.vm.UserError(bad)', '            if False:\n                raise gl.vm.UserError(bad)'),
    ("the bound flag marks every label bound",
     '                         "finding_bound": f == "TENANT_DAMAGE",', '                         "finding_bound": True,'),

    # ── reading: a node reads only what it says it saw ──────────────────────
    ("a node that never says readable counts as a reader",
     '            got[eid] = (row.get("readable") is True and bool(_clean(row.get("shows"), LONG_MAX)), row)',
     '            got[eid] = (row.get("readable", True) is True and bool(_clean(row.get("shows"), LONG_MAX)), row)'),
    ("a reading with nothing in it counts",
     '            got[eid] = (row.get("readable") is True and bool(_clean(row.get("shows"), LONG_MAX)), row)',
     '            got[eid] = (row.get("readable") is True, row)'),
    ("a photo a pair missed is not read again alone",
     '                    ok, row = self._read_group(ctx, [eid])[0][eid]', '                    pass'),
    ("a node that read nothing votes",
     '        received = bool(seen) or not ctx["photos"]', '        received = True'),
    ("the move-out photo travels alone when only the tenant photographed the room",
     '            before = base.get("LANDLORD") or base.get("TENANT")', '            before = base.get("LANDLORD")'),
    ("the reading prompt is told the claim",
     '            head += (f"Image {n} was filed {self._when_words(it)} by the {it[\'role\'].lower()}, "',
     '            head += (f"Image {n} ({\'; \'.join(d[\'description\'] for d in ctx[\'disputed\'])}) was filed {self._when_words(it)} by the {it[\'role\'].lower()}, "'),

    # ── the prompt: party text can never close a fence ──────────────────────
    ("fence ends are not defused",
     '    out = _FENCE_END.sub(r"END_\\1", str(text or ""))', '    out = str(text or "")'),
    ("one pass leaves a fence behind",
     '    while "<<<" in out or ">>>" in out:', '    if "<<<" in out or ">>>" in out:'),

    # ── the appeal ──────────────────────────────────────────────────────────
    ("the winner may appeal",
     '        if not any(to != role for to in self._standing_outcomes(lease).values()):',
     '        if False:'),
    ("any bond will do",
     '        if wei != bond:\n            raise _PayableRefusal(f"send exactly the appeal bond',
     '        if wei < 1:\n            raise _PayableRefusal(f"send exactly the appeal bond'),
    ("the bond floor is gone",
     '    return max(MIN_APPEAL_BOND_WEI, int(disputed_wei) * APPEAL_BOND_BPS // 10_000)',
     '    return int(disputed_wei) * APPEAL_BOND_BPS // 10_000'),
    ("an appeal moves on anything it did not contest",
     '        moved = any(after.get(k) == a["by"] for k in a["contested"])',
     '        moved = any(after.get(k) == a["by"] for k in after)'),
    ("an upheld appeal returns the bond",
     '        self._pay(lease, a["by"] if moved else other, int(a["bond_wei"]))',
     '        self._pay(lease, a["by"], int(a["bond_wei"]))'),
    ("a lapsed appeal keeps the bond",
     '        a["result"] = "LAPSED"\n        self._pay(lease, a["by"], int(a["bond_wei"]))',
     '        a["result"] = "LAPSED"\n        self._pay(lease, "LANDLORD" if a["by"] == "TENANT" else "TENANT", int(a["bond_wei"]))'),
    ("concessions are open under appeal",
     'OPEN_TO_CONCESSION = ("RESPONSE", "AWAITING_RULING", "RULED")',
     'OPEN_TO_CONCESSION = ("RESPONSE", "AWAITING_RULING", "RULED", "APPEALED")'),
    ("the appeal's evidence is not read by the appeal round",
     '        if kind == "APPEAL":\n            allowed.append("APPEAL")', '        if False:\n            allowed.append("APPEAL")'),
    ("appeal filings are unlimited",
     '            if len(mine) >= APPEAL_ITEMS_PER_PARTY[kind]:', '            if False:'),

    # ── windows: both sides of every boundary ───────────────────────────────
    ("the check-in period never closes for filing",
     '            if state == "CHECK_IN" and now > _parse_iso(lease["check_in_ends"]):', '            if False:'),
    ("anyone closes the baseline at once",
     '        if self._role_of(lease, self._sender()) != "TENANT" \\\n                and _now() <= _parse_iso(lease["check_in_ends"]):',
     '        if False:'),
    ("anyone ends the tenancy before the term",
     '        if self._role_of(lease, self._sender()) != "TENANT" \\\n                and _now() <= _parse_iso(lease["ends_at"]):',
     '        if False:'),
    ("claims are taken after the period",
     '        if _now() > _parse_iso(lease["claims_ends"]):\n            _refuse("the claims period has ended")',
     '        if False:\n            _refuse("the claims period has ended")'),
    ("anyone closes claims at once",
     '        if self._role_of(lease, self._sender()) != "LANDLORD" \\\n                and _now() <= _parse_iso(lease["claims_ends"]):',
     '        if False:'),
    ("answers are taken after the period",
     '        if _now() > _parse_iso(lease["response_ends"]):\n            _refuse("the response period has ended")',
     '        if False:\n            _refuse("the response period has ended")'),
    ("anyone closes answers at once",
     '        if self._role_of(lease, self._sender()) != "TENANT" \\\n                and _now() <= _parse_iso(lease["response_ends"]):',
     '        if False:'),
    ("the long stop opens at once",
     '        if _now() <= _parse_iso(lease["ruling_long_stop"]):', '        if False:'),
    ("a ruling pays inside its appeal window",
     '        if _now() <= _parse_iso(lease["appeal_ends"]):\n            _refuse("the appeal window is still open")',
     '        if False:\n            _refuse("the appeal window is still open")'),
    ("an appeal is taken after its window",
     '        if now > _parse_iso(lease["appeal_ends"]):', '        if False:'),
    ("an appeal is decided inside its evidence period",
     '        if _now() <= _parse_iso(a["evidence_ends"]):\n            _refuse("the appeal\'s evidence period is still open")',
     '        if False:\n            _refuse("the appeal\'s evidence period is still open")'),
    ("appeal evidence is taken after its period",
     '            if now > _parse_iso(a["evidence_ends"]):', '            if False:'),
    ("an appeal lapses at once",
     '        if _now() <= _parse_iso(a["lapse_at"]):', '        if False:'),

    # ── who may act ─────────────────────────────────────────────────────────
    ("anyone accepts the offer",
     '        if sender != lease["tenant"]:\n            raise _PayableRefusal', '        if False:\n            raise _PayableRefusal'),
    ("any deposit will do",
     '        if wei != int(lease["deposit_wei"]):', '        if wei < 1:'),
    ("a stranger files evidence",
     '            _refuse("only the landlord or the tenant of this lease may do that")', '            return "LANDLORD"'),
    ("the tenant files a baseline before paying",
     '            if state == "OFFERED" and role != "LANDLORD":', '            if False:'),
    ("a role files two baseline photographs of a room",
     '            if self._items_of(lease, phase="BASELINE", role=role, room_id=room_id, kind=kind):',
     '            if False:'),
    ("the landlord files notices",
     '            if role != "TENANT" or kind != "NOTE":', '            if kind != "NOTE":'),
    ("the tenant claims deductions",
     '        self._only(lease, "LANDLORD", "claims deductions")', '        pass'),
    ("the landlord answers deductions",
     '        self._only(lease, "TENANT", "answers a deduction")', '        pass'),
    ("the landlord concedes for the tenant",
     '        self._only(lease, "TENANT", "concedes a deduction")', '        pass'),
    ("the tenant withdraws for the landlord",
     '        self._only(lease, "LANDLORD", "withdraws a deduction")', '        pass'),
    ("a stranger asks for a ruling",
     '    def request_ruling(self, lid: str) -> str:\n        lease = self._lease(lid)\n        self._party(lease)',
     '    def request_ruling(self, lid: str) -> str:\n        lease = self._lease(lid)'),
    ("a stranger decides an appeal",
     '        lease = self._lease(lid)\n        self._party(lease)\n        self._state(lease, "APPEALED")',
     '        lease = self._lease(lid)\n        self._state(lease, "APPEALED")'),
    ("the tenant withdraws the offer",
     '        self._only(lease, "LANDLORD", "can withdraw an offer")', '        pass'),

    # ── limits ──────────────────────────────────────────────────────────────
    ("a fourth deduction is taken",
     '        if len(live) >= MAX_DEDUCTIONS:', '        if len(live) > MAX_DEDUCTIONS:'),
    ("a seventh notice is taken",
     '            if len(self._items_of(lease, phase="NOTICE")) >= MAX_NOTICES:', '            if False:'),
    ("a file the runtime cannot read is taken",
     '        problem = _image_problem(bytes(data))\n        if problem:', '        problem = ""\n        if problem:'),
    ("an oversized photograph is taken",
     '        if len(data) > MAX_IMAGE_BYTES:', '        if False:'),
    ("a refused payable write keeps the value",
     '            if wei:\n                self._credit(sender, wei)\n            return json.dumps({"refused": True,\n                               "reason": f"{str(e).replace(ERROR_EXPECTED + \' \', \'\')}; "\n                                         "any value sent is claimable back"})\n\n    def _accept_lease',
     '            return json.dumps({"refused": True,\n                               "reason": f"{str(e).replace(ERROR_EXPECTED + \' \', \'\')}; "\n                                         "any value sent is claimable back"})\n\n    def _accept_lease'),
]

TESTS = ["tests/direct"]


def suite_passes(work: pathlib.Path):
    env = dict(os.environ, LEASERESOLVE_WALK_SEEDS=os.environ.get("LEASERESOLVE_WALK_SEEDS", "24"))
    r = subprocess.run([sys.executable, "-m", "pytest", *TESTS, "-x", "-q", "--tb=no", "-p", "no:cacheprovider"],
                       cwd=work, capture_output=True, text=True, env=env)
    tail = [ln for ln in r.stdout.splitlines() if ln.strip()][-1:] or [""]
    return r.returncode == 0, tail[0]


def apply(text: str, edits: list):
    for old, new in edits:
        if text.count(old) != 1:
            return None
        text = text.replace(old, new)
    return text


def main() -> int:
    words = [a.lower() for a in sys.argv[1:]]
    chosen = [m for m in MUTATIONS if not words or any(w in m[0].lower() for w in words)]
    survivors = []
    with tempfile.TemporaryDirectory(prefix="leaseresolve-mutants-") as tmp:
        work = pathlib.Path(tmp)
        shutil.copytree(REPO / "contracts", work / "contracts")
        shutil.copytree(REPO / "tests", work / "tests",
                        ignore=shutil.ignore_patterns("__pycache__", "mutation"))
        shutil.copy(REPO / "pyproject.toml", work / "pyproject.toml")
        target = work / "contracts" / "leaseresolve.py"
        for entry in chosen:
            name = entry[0]
            edits = entry[1] if isinstance(entry[1], list) else [(entry[1], entry[2])]
            mutant = apply(TEXT, edits)
            if mutant is None:
                print(f"SKIPPED  {name}: a target is missing or ambiguous", flush=True)
                survivors.append(name)
                continue
            target.write_text(mutant, encoding="utf-8", newline="\n")
            passed, tail = suite_passes(work)
            print(f"{'SURVIVED' if passed else 'killed  '} {name}  ({tail})", flush=True)
            if passed:
                survivors.append(name)
                if os.environ.get("GITHUB_ACTIONS"):
                    print(f"::error title=mutant survived::{name}", flush=True)
        target.write_text(TEXT, encoding="utf-8", newline="\n")
        passed, tail = suite_passes(work)
    print(f"control, the contract as written: {'passes' if passed else 'FAILS'} ({tail})")
    print(f"{len(chosen) - len(survivors)}/{len(chosen)} mutants killed")
    if survivors:
        print("survivors: " + "; ".join(survivors))
    return 0 if passed and not survivors else 1


if __name__ == "__main__":
    sys.exit(main())
