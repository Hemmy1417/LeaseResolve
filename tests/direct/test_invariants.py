"""Invariants, not scripts. Random walks send every act from every actor at
every moment, two leases at once, and after each step check what must always
hold: no wei made or lost, a settled lease never changes again, and the
contract never owes more than it was paid."""
import json
import random
from datetime import datetime, timedelta, timezone

import pytest

from conftest import (  # noqa: F401
    GEN, LANDLORD, STRANGER, TENANT, _NOW, as_, claimable, conserved, err, jfif, judgment,
    lease, lease_params, llm, look_ok, transfers,
)

ACTORS = (LANDLORD, TENANT, STRANGER)
FINDINGS = ("TENANT_DAMAGE", "PRE_EXISTING", "FAIR_WEAR", "REPORTED_UNREPAIRED", "NOT_SHOWN")


def queue_any_judgment(rng, c, lid):
    l = lease(c, lid)
    items = l["items"]
    findings, basis = {}, {}
    for d in l["deductions"]:
        if d["state"] != "DISPUTED":
            continue
        findings[d["id"]] = rng.choice(FINDINGS)
        basis[d["id"]] = rng.sample([it["item_id"] for it in items], k=min(3, len(items)))
    llm(look=look_ok(), judge=judgment(findings, basis))


RELEVANT = {
    "OFFERED": [0, 1, 2], "CHECK_IN": [1, 2, 3, 3], "TENANCY": [2, 4, 4],
    "MOVE_OUT": [5, 5, 5, 5, 6, 7], "RESPONSE": [8, 8, 8, 9, 10],
    "AWAITING_RULING": [6, 9, 11, 11, 11, 12], "RULED": [6, 9, 13, 14, 14],
    "APPEALED": [1, 2, 6, 9, 15, 15, 16], "SETTLED": list(range(17)), "CANCELLED": [0],
}


# Who each act is usually for; a third of the time anybody tries it.
PROPER = {0: (TENANT,), 1: (LANDLORD, TENANT), 2: (LANDLORD, TENANT), 3: (TENANT,),
          4: (TENANT,), 5: (LANDLORD,), 6: (LANDLORD,), 7: (LANDLORD,), 8: (TENANT,),
          9: (TENANT,), 10: (TENANT,), 11: (LANDLORD, TENANT), 12: (STRANGER,),
          13: (STRANGER,), 14: (LANDLORD, TENANT), 15: (LANDLORD, TENANT), 16: (STRANGER,)}


def act(rng, module, c, lid):
    l = lease(c, lid)
    did = rng.choice([d["id"] for d in l["deductions"]] or ["D1"])
    room = rng.choice(["R1", "R2", "R3"])
    # Mostly the acts this state is for, so the walk reaches rulings, appeals
    # and their long stops; sometimes anything at all, so it also tries the
    # walls between them.
    pick = rng.choice(RELEVANT[l["state"]]) if rng.random() < 0.8 else rng.randrange(17)
    who = rng.choice(PROPER[pick]) if rng.random() < 0.67 else rng.choice(ACTORS)
    as_(module, who)
    if pick == 0:
        as_(module, who, int(l["deposit_wei"]) if rng.random() < 0.7 else GEN)
        c.accept_lease(lid)
    elif pick == 1:
        c.file_photo(lid, json.dumps({"room_id": room, "deduction_id": did}),
                     jfif(str(rng.random()).encode()))
    elif pick == 2:
        c.file_note(lid, json.dumps({"room_id": room, "deduction_id": did}), "Some words.")
    elif pick == 3:
        c.confirm_baseline(lid)
    elif pick == 4:
        c.end_tenancy(lid)
    elif pick == 5:
        c.file_deduction(lid, room, "A stain", str(rng.choice([GEN // 3, GEN, 2 * GEN])),
                         jfif(str(rng.random()).encode()))
    elif pick == 6:
        c.withdraw_deduction(lid, did)
    elif pick == 7:
        c.close_claims(lid)
    elif pick == 8:
        c.answer_deduction(lid, did, rng.random() < 0.15, "Not mine.", b"")
    elif pick == 9:
        c.concede_deduction(lid, did)
    elif pick == 10:
        c.close_responses(lid)
    elif pick == 11:
        queue_any_judgment(rng, c, lid)
        c.request_ruling(lid)
    elif pick == 12:
        c.settle_unresolved(lid)
    elif pick == 13:
        c.finalize(lid)
    elif pick == 14:
        bond = int(l["appeal_bond_wei"])
        as_(module, who, bond if rng.random() < 0.8 else bond + 1)
        c.open_appeal(lid, "The ruling was wrong.")
    elif pick == 15:
        queue_any_judgment(rng, c, lid)
        c.decide_appeal(lid)
    else:
        c.lapse_appeal(lid)


def contract_owes(c):
    """What the ledger owes plus what leases still hold."""
    owed = sum(int(json.loads(c.ledger[a])["claimable"]) for a in c.ledger)
    held = sum(int(json.loads(v)["held_wei"]) for v in c.leases.values())
    return owed + held


@pytest.mark.parametrize("seed", range(120))
def test_a_random_walk_keeps_every_invariant(module, c, seed):
    rng = random.Random(seed)
    paid_in = 0
    lids = []
    for _ in range(2):
        as_(module, LANDLORD)
        lids.append(json.loads(c.create_lease(lease_params()))["lease_id"])
    settled = {}
    for step in range(260):
        _NOW[0] += timedelta(seconds=rng.choice([0, 0, 30, 300, 900, 2500]))
        lid = rng.choice(lids)
        before = c.leases[lid]
        try:
            act(rng, module, c, lid)
        except err(module):
            assert c.leases[lid] == before, "a refusal leaves nothing behind"
        except BaseException as e:  # a crash is a defect, never a refusal
            if type(e).__name__ == "_NoAnswer":
                raise
            raise AssertionError(f"step {step}: a bare {type(e).__name__}: {e}")
        paid_in += int(module.gl.message.value or 0)
        as_(module, LANDLORD, 0)
        for x in lids:
            assert conserved(c, x), f"step {step}: {x} lost or made wei"
            if x in settled:
                assert c.leases[x] == settled[x], f"step {step}: a settled lease changed"
            elif lease(c, x)["state"] == "SETTLED":
                assert lease(c, x)["held_wei"] == "0", "a settled lease holds nothing"
                settled[x] = c.leases[x]
        claimed = sum(t["wei"] for t in transfers())
        assert contract_owes(c) + claimed == paid_in, f"step {step}: the books do not balance"
        if rng.random() < 0.1:
            as_(module, rng.choice(ACTORS))
            try:
                c.claim()
            except err(module):
                pass


def test_two_concurrent_appeals_take_one_bond(module, c):
    """Both sides lost a deduction; both try to appeal. One bond is held, the
    second is credited straight back."""
    from conftest import disputed, rule
    lid, ids, _ = disputed(module, c, n=2)
    rule(module, c, lid, judgment({"D1": "TENANT_DAMAGE", "D2": "FAIR_WEAR"},
                                  {"D1": [ids["bl_r1"], ids["out_D1"]]}))
    b = int(lease(c, lid)["appeal_bond_wei"])
    as_(module, TENANT, b)
    assert json.loads(c.open_appeal(lid, "first"))["refused"] is False
    as_(module, LANDLORD, b)
    assert json.loads(c.open_appeal(lid, "second"))["refused"] is True
    assert claimable(c, LANDLORD) == b and lease(c, lid)["appeal"]["by"] == "TENANT"
    assert conserved(c, lid)


def test_nothing_reopens_a_settled_lease(module, c):
    from conftest import disputed, rule
    lid, ids, _ = disputed(module, c, n=1)
    rule(module, c, lid, judgment({"D1": "FAIR_WEAR"}))
    _NOW[0] = datetime(2026, 10, 2, tzinfo=timezone.utc)
    as_(module, STRANGER)
    c.finalize(lid)
    frozen = c.leases[lid]
    for who in ACTORS:
        as_(module, who)
        for call in (lambda: c.request_ruling(lid), lambda: c.decide_appeal(lid),
                     lambda: c.lapse_appeal(lid), lambda: c.settle_unresolved(lid),
                     lambda: c.withdraw_deduction(lid, "D1"),
                     lambda: c.concede_deduction(lid, "D1"), lambda: c.close_responses(lid),
                     lambda: c.file_note(lid, '{"room_id": "R1", "deduction_id": "D1"}', "late")):
            with pytest.raises(err(module)):
                call()
        as_(module, who, GEN)
        assert json.loads(c.open_appeal(lid, "late"))["refused"] is True
    assert c.leases[lid] == frozen
