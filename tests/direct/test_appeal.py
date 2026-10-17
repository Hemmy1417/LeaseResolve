"""The appeal: who may bring one, the bond, the evidence period, the second
round, and the long stop that keeps it from holding anything forever."""
import json

import pytest

from conftest import (  # noqa: F401
    DEPOSIT, GEN, LANDLORD, STRANGER, TENANT, as_, claimable, conserved, disputed, err,
    jfif, judgment, lease, llm, look_ok, note, photo, prompts, reset_prompts, rule, set_now,
)

BOND = 10**17  # 5% of one disputed GEN would be 0.05; the floor is 0.01. Computed below.


def damage_basis(ids, did="D1", room="r1"):
    return {did: [ids[f"bl_{room}"], ids[f"out_{did}"]]}


def ruled_for_landlord(module, c, n=1):
    lid, ids, dids = disputed(module, c, n=n)
    findings = {d: "TENANT_DAMAGE" for d in dids}
    basis = {"D1": [ids["bl_r1"], ids["out_D1"]]}
    if n > 1:
        basis["D2"] = [ids["bl_r2"], ids["out_D2"]]
    rule(module, c, lid, judgment(findings, basis))
    return lid, ids


def bond(c, lid):
    return int(lease(c, lid)["appeal_bond_wei"])


def appeal(module, c, lid, who=TENANT, wei=None, reason="The marks were there at move-in."):
    as_(module, who, bond(c, lid) if wei is None else wei)
    out = json.loads(c.open_appeal(lid, reason))
    as_(module, who, 0)
    return out


class TestOpening:
    def test_the_bond_is_five_percent_with_a_floor(self, module, c):
        assert module._bond_for(GEN) == 5 * 10**16
        assert module._bond_for(10**16) == 10**16
        lid, _ = ruled_for_landlord(module, c, n=2)
        assert bond(c, lid) == 10**17

    def test_the_losing_side_appeals_with_the_bond(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        out = appeal(module, c, lid)
        assert out["refused"] is False and out["state"] == "APPEALED"
        a = lease(c, lid)["appeal"]
        assert a["by"] == "TENANT" and a["evidence_ends"] == "2026-10-01T10:00:00Z"
        assert a["lapse_at"] == "2026-10-01T13:00:00Z"
        assert conserved(c, lid)

    @pytest.mark.parametrize("who,wei,words", [
        (LANDLORD, None, "went your way on every deduction"),
        (STRANGER, None, "only the landlord or the tenant"),
        (TENANT, 1, "exactly the appeal bond"),
        (TENANT, 0, "exactly the appeal bond"),
    ])
    def test_a_wrong_appeal_is_refused_and_credited_back(self, module, c, who, wei, words):
        lid, _ = ruled_for_landlord(module, c)
        before = claimable(c, who)
        sent = bond(c, lid) if wei is None else wei
        out = appeal(module, c, lid, who=who, wei=wei)
        assert out["refused"] is True and words in out["reason"]
        assert claimable(c, who) == before + sent
        assert lease(c, lid)["state"] == "RULED"

    def test_an_appeal_needs_a_reason(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        out = appeal(module, c, lid, reason=" ")
        assert out["refused"] is True and "give a reason" in out["reason"]

    def test_the_window_closes(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        set_now("2026-10-01T10:00:01Z")
        out = appeal(module, c, lid)
        assert out["refused"] is True and "window has closed" in out["reason"]

    def test_only_one_appeal(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        out = appeal(module, c, lid, who=TENANT, wei=bond(c, lid))
        assert out["refused"] is True and "only a standing ruling" in out["reason"]

    def test_an_appeal_on_an_unknown_lease_is_refused(self, module, c):
        as_(module, TENANT, GEN)
        out = json.loads(c.open_appeal("ls-00042", "why"))
        assert out["refused"] is True and claimable(c, TENANT) == GEN

    def test_a_landlord_who_lost_a_deduction_may_appeal(self, module, c):
        lid, ids, _ = disputed(module, c, n=1)
        rule(module, c, lid, judgment({"D1": "FAIR_WEAR"}))
        assert appeal(module, c, lid, who=LANDLORD)["refused"] is False


class TestEvidence:
    def test_each_side_files_new_evidence_for_a_disputed_deduction(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        p = photo(module, c, lid, TENANT, caption="close-up", did="D1")
        it = json.loads(c.get_item(p))
        assert it["phase"] == "APPEAL" and it["room_id"] == "R1" and it["deduction_id"] == "D1"
        note(module, c, lid, LANDLORD, text="The wall was repainted in August.", did="D1")
        note(module, c, lid, LANDLORD, text="Receipt for the paint is attached.", did="D1")
        with pytest.raises(err(module), match="at most 2 notes"):
            note(module, c, lid, LANDLORD, text="A third note.", did="D1")
        with pytest.raises(err(module), match="at most 1 photograph"):
            photo(module, c, lid, TENANT, caption="another", did="D1")
        # One side's filings never use up the other's.
        photo(module, c, lid, LANDLORD, caption="landlord close-up", did="D1")

    def test_evidence_names_a_disputed_deduction(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        with pytest.raises(err(module), match="no deduction"):
            note(module, c, lid, TENANT, text="Some words here.", did="")

    def test_the_evidence_period_ends(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        set_now("2026-10-01T10:00:01Z")
        with pytest.raises(err(module), match="evidence period has ended"):
            note(module, c, lid, TENANT, text="Late words.", did="D1")


class TestTheSecondRound:
    def decide(self, module, c, lid, judge, look=None, who=TENANT):
        llm(look=look if look is not None else look_ok(), judge=judge)
        as_(module, who)
        return json.loads(c.decide_appeal(lid))

    def test_it_waits_for_the_evidence_period(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        llm(look=look_ok(), judge=judgment({"D1": "FAIR_WEAR"}))
        as_(module, TENANT)
        with pytest.raises(err(module), match="evidence period is still open"):
            c.decide_appeal(lid)

    def test_a_moved_deduction_returns_the_bond_and_pays_the_tenant(self, module, c):
        lid, ids = ruled_for_landlord(module, c)
        b = bond(c, lid)
        appeal(module, c, lid)
        new = photo(module, c, lid, TENANT, caption="close-up", did="D1")
        set_now("2026-10-01T10:00:01Z")
        reset_prompts()
        out = self.decide(module, c, lid, judgment({"D1": "PRE_EXISTING"}, {"D1": [ids["bl_r1"]]}))
        assert out["result"] == "MOVED" and out["deductions"][0]["to"] == "TENANT"
        assert claimable(c, TENANT) == DEPOSIT + b and claimable(c, LANDLORD) == 0
        l = lease(c, lid)
        assert l["state"] == "SETTLED" and l["settled_how"] == "APPEAL" and conserved(c, lid)
        r = json.loads(c.get_round(lid, 2))
        assert r["kind"] == "APPEAL" and r["new_items"] == [new]
        assert r["appeal_by"] == "TENANT" and "move-in" in r["reason"]
        judge = prompts("judge", "leader")[0]["prompt"]
        assert "This is an appeal by the tenant" in judge and new in judge

    def test_an_upheld_ruling_pays_the_bond_to_the_other_side(self, module, c):
        lid, ids = ruled_for_landlord(module, c)
        b = bond(c, lid)
        appeal(module, c, lid)
        set_now("2026-10-01T10:00:01Z")
        out = self.decide(module, c, lid, judgment({"D1": "TENANT_DAMAGE"}, damage_basis(ids)))
        assert out["result"] == "UPHELD"
        assert claimable(c, LANDLORD) == GEN + b and claimable(c, TENANT) == 4 * GEN
        assert conserved(c, lid)

    def test_one_moved_deduction_of_two_is_enough(self, module, c):
        lid, ids = ruled_for_landlord(module, c, n=2)
        b = bond(c, lid)
        appeal(module, c, lid)
        set_now("2026-10-01T10:00:01Z")
        out = self.decide(module, c, lid, judgment(
            {"D1": "TENANT_DAMAGE", "D2": "FAIR_WEAR"}, damage_basis(ids)))
        assert out["result"] == "MOVED"
        assert claimable(c, TENANT) == 3 * GEN + GEN + b and claimable(c, LANDLORD) == GEN

    def test_an_appeal_can_move_against_the_appellant_too(self, module, c):
        lid, ids, _ = disputed(module, c, n=2)
        rule(module, c, lid, judgment({"D1": "TENANT_DAMAGE", "D2": "FAIR_WEAR"},
                                      damage_basis(ids)))
        b = bond(c, lid)
        appeal(module, c, lid, who=TENANT)
        set_now("2026-10-01T10:00:01Z")
        out = self.decide(module, c, lid, judgment(
            {"D1": "TENANT_DAMAGE", "D2": "TENANT_DAMAGE"},
            {"D1": [ids["bl_r1"], ids["out_D1"]], "D2": [ids["bl_r2"], ids["out_D2"]]}))
        assert out["result"] == "UPHELD"
        assert claimable(c, LANDLORD) == 2 * GEN + b and conserved(c, lid)

    def test_the_appeal_round_reads_the_new_photograph(self, module, c):
        lid, ids = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        photo(module, c, lid, TENANT, caption="close-up", did="D1")
        set_now("2026-10-01T10:00:01Z")
        reset_prompts()
        self.decide(module, c, lid, judgment({"D1": "FAIR_WEAR"}))
        assert [p["images"] for p in prompts("look", "leader")] == [2, 1]

    def test_a_failed_appeal_round_changes_nothing(self, module, c):
        lid, ids = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        set_now("2026-10-01T10:00:01Z")
        llm(look=look_ok(), judge=judgment({"D1": "FAIR_WEAR"}),
            v_judge=judgment({"D1": "NOT_SHOWN"}))
        as_(module, TENANT)
        with pytest.raises(err(module), match="did not agree"):
            c.decide_appeal(lid)
        assert lease(c, lid)["state"] == "APPEALED" and lease(c, lid)["round_count"] == 1

    def test_only_a_party_decides_an_appeal(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        set_now("2026-10-01T10:00:01Z")
        as_(module, STRANGER)
        with pytest.raises(err(module), match="only the landlord or the tenant"):
            c.decide_appeal(lid)


class TestTheLongStop:
    def test_an_undecided_appeal_lapses_to_the_first_ruling(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        b = bond(c, lid)
        appeal(module, c, lid)
        as_(module, STRANGER)
        set_now("2026-10-01T13:00:00Z")
        with pytest.raises(err(module), match="has not lapsed"):
            c.lapse_appeal(lid)
        set_now("2026-10-01T13:00:01Z")
        c.lapse_appeal(lid)
        l = lease(c, lid)
        assert l["appeal"]["result"] == "LAPSED" and l["settled_how"] == "APPEAL_LAPSED"
        assert claimable(c, LANDLORD) == GEN and claimable(c, TENANT) == 4 * GEN + b
        assert conserved(c, lid)

    def test_nothing_is_given_up_while_an_appeal_is_pending(self, module, c):
        """The appeal round decides what it covers: a concession mid-appeal could
        otherwise moot it, abandon it for free, or take its bond."""
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="while the lease is appealed"):
            c.withdraw_deduction(lid, "D1")
        as_(module, TENANT)
        with pytest.raises(err(module), match="while the lease is appealed"):
            c.concede_deduction(lid, "D1")
        assert lease(c, lid)["state"] == "APPEALED" and conserved(c, lid)

    def test_a_ruled_lease_cannot_be_finalized_while_appealed(self, module, c):
        lid, _ = ruled_for_landlord(module, c)
        appeal(module, c, lid)
        set_now("2026-10-02T00:00:00Z")
        as_(module, STRANGER)
        with pytest.raises(err(module), match="while the lease is appealed"):
            c.finalize(lid)
