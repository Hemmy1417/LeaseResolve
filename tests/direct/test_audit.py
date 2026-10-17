"""Regressions from the first adversarial review, each a test that failed on
the code it was written against."""
import json

from conftest import (  # noqa: F401
    GEN, LANDLORD, TENANT, _ANSWERS, as_, claimable, conserved, deduct, disputed, err,
    forge_leader, in_tenancy, jfif, judgment, lease, llm, look_ok, moved_out, offered, photo,
    accept, set_now,
)
import pytest


def _two_deductions_tenant_answers_d1_with_photo(module, c):
    lid, ids = moved_out(module, c)
    d1 = deduct(module, c, lid, "R1", GEN, "Holes in the wall")
    d2 = deduct(module, c, lid, "R2", GEN, "Cracked sink")
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, d1["deduction_id"], False, "It was like that.", jfif(b"POISON"))
    c.answer_deduction(lid, d2["deduction_id"], False, "It was like that.", b"")
    c.close_responses(lid)
    return lid, ids, d1, d2


def test_tenant_photo_the_runtime_rejects_sets_aside_landlords_other_room_baseline(module, c):
    """HIGH: groups are cut by position, so the tenant's answer photo for D1
    shares a prompt with the landlord's R2 baseline. A file the runtime rejects
    sets aside both, defeating D2's TENANT_DAMAGE."""
    lid, ids, d1, d2 = _two_deductions_tenant_answers_d1_with_photo(module, c)

    def look(prompt, images):
        if any(b"POISON" in bytes(i) for i in images):
            raise RuntimeError("INVALID_IMAGE")
        return look_ok(len(images))

    llm(look=look, judge=judgment(
        {"D1": "NOT_SHOWN", "D2": "TENANT_DAMAGE"},
        {"D2": [ids["bl_r2"], d2["photo"]]}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    to = {r["id"]: r["to"] for r in out["deductions"]}
    assert to["D2"] == "LANDLORD", out


def test_move_in_and_move_out_of_a_room_share_a_prompt(module, c):
    """MEDIUM: docstring promises the move-in photo travels beside the move-out
    photo of the same room; positional grouping breaks that for D2."""
    lid, ids, d1, d2 = _two_deductions_tenant_answers_d1_with_photo(module, c)
    ctx = c._round_context(json.loads(c.leases[lid]), "RULING")
    assert any(ids["bl_r2"] in g and d2["photo"] in g for g in ctx["groups"]), ctx["groups"]


def test_record_read_lists_only_what_the_round_showed(module, c):
    """LOW: `read` lists every item of the lease, including photographs never
    put to any node (an accepted deduction's move-out photo)."""
    lid, ids = moved_out(module, c)
    d1 = deduct(module, c, lid, "R1", GEN, "Holes in the wall")
    d2 = deduct(module, c, lid, "R2", GEN, "Cracked sink")
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, d1["deduction_id"], False, "It was like that.", b"")
    c.answer_deduction(lid, d2["deduction_id"], True, "", b"")
    c.close_responses(lid)
    llm(look=look_ok(), judge=judgment({"D1": "FAIR_WEAR"}))
    c.request_ruling(lid)
    rec = lease(c, lid)["rounds"][0]
    read = [r["item_id"] for r in rec["read"]]
    assert d2["photo"] not in read


def test_the_record_carries_no_leader_only_reading(module, c):
    """A leader's claim about which photographs went unread is not written into
    the record: validators never agreed on it."""
    lid, ids, _ = disputed(module, c, n=1)
    llm(look=look_ok(), judge=judgment({"D1": "FAIR_WEAR"}))
    forge_leader({"images_received": True, "findings": {"D1": "FAIR_WEAR"},
                  "basis": {"D1": []}, "notes": {}, "reasoning": "",
                  "unread": [ids["bl_r1"]], "read": []})
    as_(module, TENANT)
    c.request_ruling(lid)
    assert "unread" not in lease(c, lid)["rounds"][0]


def test_a_leader_basis_the_validator_could_not_see_is_refused(module, c):
    """Same finding, but the leader grounds it on the tenant's baseline photo,
    which this validator could not read: the validator cannot stand behind the
    basis the record would carry."""
    lid, ids = in_tenancy(module, c, tenant_photo=True)
    as_(module, TENANT)
    c.end_tenancy(lid)
    out = deduct(module, c, lid, "R1", GEN)
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, "D1", False, "Not mine.", b"")
    c.close_responses(lid)
    blind_to_tenant = {"images": [{"n": 1, "readable": False, "shows": ""}]}
    llm(look=[look_ok(2), look_ok(1)],
        judge=judgment({"D1": "TENANT_DAMAGE"}, {"D1": [ids["blt_r1"], out["photo"]]}),
        v_look=[look_ok(2), blind_to_tenant],
        v_judge=judgment({"D1": "TENANT_DAMAGE"}, {"D1": [ids["bl_r1"], out["photo"]]}))
    as_(module, TENANT)
    with pytest.raises(err(module), match="did not agree"):
        c.request_ruling(lid)


# ── round 2 ──

def _poison_look(prompt, images):
    if any(b"POISON" in bytes(i) for i in images):
        raise RuntimeError("INVALID_IMAGE")
    return look_ok(len(images))


def _landlord_no_baseline_photo(module, c, rooms, answers):
    """Only the tenant holds a baseline photograph of R1."""
    lid, ids = moved_out(module, c, baseline=False, tenant_photo=True)
    ds = [deduct(module, c, lid, r, GEN, f"Holes in the wall {i}") for i, r in enumerate(rooms)]
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    for d, a in zip(ds, answers):
        c.answer_deduction(lid, d["deduction_id"], False, "It was like that.", a)
    c.close_responses(lid)
    return lid, ids, ds


def test_tenant_bad_answer_photo_sets_aside_the_shared_baseline(module, c):
    """MEDIUM: the tenant's runtime-rejected answer photo shares a prompt with
    the tenant's baseline photo (a frozen, shared baseline item), so the
    tenant's own bad file removes the only 'before' and defeats TENANT_DAMAGE."""
    lid, ids, ds = _landlord_no_baseline_photo(module, c, ["R1"], [jfif(b"POISON")])
    llm(look=_poison_look, judge=judgment(
        {"D1": "TENANT_DAMAGE"}, {"D1": [ids["blt_r1"], ds[0]["photo"]]}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    assert out["deductions"][0]["to"] == "LANDLORD", out


def test_first_reading_kept_lets_d1_poison_d2(module, c):
    """MEDIUM: the shared baseline is read again beside D2 and read cleanly,
    but the set-aside first reading (from D1's poisoned prompt) is kept."""
    lid, ids, ds = _landlord_no_baseline_photo(module, c, ["R1", "R1"], [jfif(b"POISON"), b""])
    llm(look=_poison_look, judge=judgment(
        {"D1": "NOT_SHOWN", "D2": "TENANT_DAMAGE"},
        {"D2": [ids["blt_r1"], ds[1]["photo"]]}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    to = {r["id"]: r["to"] for r in out["deductions"]}
    assert to["D2"] == "LANDLORD", out


def test_move_out_photo_never_beside_the_only_baseline_photo(module, c):
    """LOW: with only the tenant's baseline photo, no prompt compares it with
    the landlord's move-out photo."""
    lid, ids, ds = _landlord_no_baseline_photo(module, c, ["R1"], [b""])
    ctx = c._round_context(json.loads(c.leases[lid]), "RULING")
    assert any(ids["blt_r1"] in g and ds[0]["photo"] in g for g in ctx["groups"]), ctx["groups"]




# ── tests that pin the round-2 rules (each killed a surviving mutant) ──

def test_a_photo_a_pair_fails_is_read_again_alone(module, c):
    """The landlord filed no baseline photo of R1 and a move-out photo the runtime
    refuses; the tenant's baseline photo shares its prompt. It is read again on
    its own and still grounds the tenant's finding."""
    lid, ids = moved_out(module, c, baseline=False, tenant_photo=True)
    deduct(module, c, lid, "R1", GEN, "Holes in the wall", data=jfif(b"POISON"))
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, "D1", False, "It was like that.", b"")
    c.close_responses(lid)
    llm(look=_poison_look,
        judge=judgment({"D1": "PRE_EXISTING"}, {"D1": [ids["blt_r1"]]}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    assert out["deductions"][0]["finding"] == "PRE_EXISTING"


def test_a_photo_set_aside_once_and_read_later_counts_as_read(module, c):
    """Two deductions in R1 share its baseline photo. The first time it is put
    to the node, the node says it cannot read it; the second time it reads it.
    It counts as read."""
    lid, ids, ds = _landlord_no_baseline_photo(module, c, ["R1", "R1"], [b"", b""])
    seen = {"n": 0}
    blt = c.get_image(ids["blt_r1"])

    def look(prompt, images):
        rows = []
        for i, img in enumerate(images, start=1):
            if bytes(img) == bytes(blt):
                seen["n"] += 1
                if seen["n"] <= 2:
                    rows.append({"n": i, "readable": False, "shows": ""})
                    continue
            rows.append({"n": i, "readable": True, "shows": "A wall.", "marks": []})
        return {"images": rows}

    llm(look=look, judge=judgment(
        {"D1": "PRE_EXISTING", "D2": "PRE_EXISTING"},
        {"D1": [ids["blt_r1"]], "D2": [ids["blt_r1"]]}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    assert [r["finding"] for r in out["deductions"]] == ["PRE_EXISTING", "PRE_EXISTING"]


def test_an_appeal_that_moves_only_what_it_did_not_contest_is_upheld(module, c):
    """The tenant contests D1 only. The appeal leaves D1 with the landlord and D2
    with the tenant, as before: nothing contested moved, so the bond is lost."""
    lid, ids, dids = disputed(module, c, n=2)
    llm(look=look_ok(), judge=judgment(
        {"D1": "TENANT_DAMAGE", "D2": "FAIR_WEAR"}, {"D1": [ids["bl_r1"], ids["out_D1"]]}))
    as_(module, TENANT)
    c.request_ruling(lid)
    bond = int(lease(c, lid)["appeal_bond_wei"])
    as_(module, TENANT, bond)
    c.open_appeal(lid, "D1 was there before.")
    set_now("2026-10-01T10:00:01Z")
    llm(look=look_ok(), judge=judgment(
        {"D1": "TENANT_DAMAGE", "D2": "FAIR_WEAR"}, {"D1": [ids["bl_r1"], ids["out_D1"]]}))
    l0 = claimable(c, LANDLORD)
    as_(module, TENANT)
    out = json.loads(c.decide_appeal(lid))
    assert out["result"] == "UPHELD"
    assert claimable(c, LANDLORD) - l0 == GEN + bond


# ── round 3 ──

def test_a_garbled_reading_of_ones_own_photo_does_not_block_the_ruling(module, c):
    """A move-out photograph whose readings come back garbled is set aside; the
    round is still decided on the rest, so no side can force the long stop."""
    lid, ids = moved_out(module, c)
    deduct(module, c, lid, "R1", GEN, "Holes", data=jfif(b"STEER"))
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, "D1", False, "Nothing is wrong.", b"")
    c.close_responses(lid)

    def look(prompt, images):
        if any(b"STEER" in bytes(i) for i in images):
            return {"images": [{"n": n, "readable": "yes", "shows": "x"} for n in range(1, len(images) + 1)]}
        return look_ok(len(images))

    llm(look=look, judge=judgment({"D1": "NOT_SHOWN"}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    assert out["deductions"][0]["to"] == "TENANT"


def test_a_photograph_is_read_alone_once_however_many_deductions_cite_its_room(module, c):
    lid, ids = moved_out(module, c, tenant_photo=True)
    deduct(module, c, lid, "R1", GEN, "Holes one")
    deduct(module, c, lid, "R1", GEN, "Holes two")
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, "D1", False, "No.", b"")
    c.answer_deduction(lid, "D2", False, "No.", b"")
    c.close_responses(lid)
    ctx = c._round_context(json.loads(c.leases[lid]), "RULING")
    assert sum(g == [ids["blt_r1"]] for g in ctx["groups"]) == 1, ctx["groups"]


# ── round 4 ──

def test_a_tenant_side_finding_on_a_photo_one_validator_missed_still_agrees(module, c):
    """The leader finds the mark already there, citing the tenant's move-in
    photograph; a validator that could not read that photograph finds it not
    shown. Both return the deduction to the tenant, so they agree: only tenant
    damage must stand on what each validator itself saw."""
    lid, ids = in_tenancy(module, c, baseline=False, tenant_photo=True)
    as_(module, TENANT)
    c.end_tenancy(lid)
    deduct(module, c, lid, "R1", GEN)
    as_(module, LANDLORD)
    c.close_claims(lid)
    as_(module, TENANT)
    c.answer_deduction(lid, "D1", False, "It was there at move-in.", b"")
    c.close_responses(lid)
    blind = {"images": [{"n": 1, "readable": False, "shows": ""}, {"n": 2, "readable": True, "shows": "A wall."}]}
    llm(look=look_ok(2), judge=judgment({"D1": "PRE_EXISTING"}, {"D1": [ids["blt_r1"]]}),
        v_look=[blind, {"images": [{"n": 1, "readable": False, "shows": ""}]}],
        v_judge=judgment({"D1": "NOT_SHOWN"}))
    as_(module, TENANT)
    out = json.loads(c.request_ruling(lid))
    assert out["deductions"][0] == {"id": "D1", "finding": "PRE_EXISTING", "to": "TENANT"}
