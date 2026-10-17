"""Regressions from the first adversarial review, each a test that failed on
the code it was written against."""
import json

from conftest import (  # noqa: F401
    GEN, LANDLORD, TENANT, _ANSWERS, as_, deduct, disputed, err, forge_leader, in_tenancy,
    jfif, judgment, lease, llm, look_ok, moved_out,
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
