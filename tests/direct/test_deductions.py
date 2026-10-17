"""Move-out: the claims, the release of what nobody claims, the answers, and
the concessions either side may make at any time."""
import json

import pytest

from conftest import (  # noqa: F401
    DEPOSIT, GEN, LANDLORD, STRANGER, TENANT, as_, claimable, conserved, deduct, disputed,
    err, jfif, lease, moved_out, set_now, transfers,
)


class TestClaims:
    def test_a_deduction_carries_its_move_out_photograph(self, module, c):
        lid, _ = moved_out(module, c)
        out = deduct(module, c, lid, "R1", GEN)
        d = lease(c, lid)["deductions"][0]
        assert out["deduction_id"] == "D1" and d["photo"] == out["photo"]
        it = json.loads(c.get_item(out["photo"]))
        assert it["phase"] == "MOVE_OUT" and it["room_id"] == "R1" and it["deduction_id"] == "D1"

    def test_only_the_landlord_claims_and_only_in_the_claims_period(self, module, c):
        lid, _ = moved_out(module, c)
        as_(module, TENANT)
        with pytest.raises(err(module), match="only the landlord"):
            c.file_deduction(lid, "R1", "Stain on the wall", str(GEN), jfif(b"t"))
        set_now("2026-10-01T10:00:01Z")
        with pytest.raises(err(module), match="claims period has ended"):
            deduct(module, c, lid)

    @pytest.mark.parametrize("room,text,amount,data,words", [
        ("R9", "Stain on the wall", GEN, None, "no room R9"),
        ("R1", "", GEN, None, "say what the deduction is for"),
        ("R1", "Stain", 0, None, "more than zero"),
        ("R1", "Stain", DEPOSIT + 1, None, "more than the deposit"),
        ("R1", "Stain", GEN, b"", "photograph is empty"),
    ])
    def test_a_bad_deduction_is_refused(self, module, c, room, text, amount, data, words):
        lid, _ = moved_out(module, c)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match=words):
            c.file_deduction(lid, room, text, str(amount), jfif(b"x") if data is None else data)

    def test_the_deductions_together_never_exceed_the_deposit(self, module, c):
        lid, _ = moved_out(module, c)
        deduct(module, c, lid, "R1", 3 * GEN)
        with pytest.raises(err(module), match="more than the deposit"):
            deduct(module, c, lid, "R2", 2 * GEN + 1)
        deduct(module, c, lid, "R2", 2 * GEN)

    def test_at_most_three_live_deductions(self, module, c):
        lid, _ = moved_out(module, c)
        for room in ("R1", "R2", "R3"):
            deduct(module, c, lid, room, GEN)
        with pytest.raises(err(module), match="at most 3 deductions"):
            deduct(module, c, lid, "R1", GEN, text="one more")
        as_(module, LANDLORD)
        c.withdraw_deduction(lid, "D1")
        deduct(module, c, lid, "R1", GEN, text="instead")
        assert [d["state"] for d in lease(c, lid)["deductions"]] == \
            ["WITHDRAWN", "CLAIMED", "CLAIMED", "CLAIMED"]

    def test_a_withdrawn_deduction_cannot_be_withdrawn_again(self, module, c):
        lid, _ = moved_out(module, c)
        deduct(module, c, lid)
        as_(module, LANDLORD)
        c.withdraw_deduction(lid, "D1")
        with pytest.raises(err(module), match="already been withdrawn"):
            c.withdraw_deduction(lid, "D1")
        with pytest.raises(err(module), match="no deduction D7"):
            c.withdraw_deduction(lid, "D7")


class TestRelease:
    def test_what_the_claims_do_not_ask_for_is_the_tenants_at_once(self, module, c):
        lid, _ = moved_out(module, c)
        deduct(module, c, lid, "R1", 2 * GEN)
        as_(module, LANDLORD)
        out = json.loads(c.close_claims(lid))
        assert out["state"] == "RESPONSE" and out["released_wei"] == str(3 * GEN)
        assert claimable(c, TENANT) == 3 * GEN
        assert lease(c, lid)["held_wei"] == str(2 * GEN) and conserved(c, lid)

    def test_no_claims_returns_the_whole_deposit(self, module, c):
        lid, _ = moved_out(module, c)
        set_now("2026-10-01T10:00:01Z")
        as_(module, STRANGER)
        out = json.loads(c.close_claims(lid))
        assert out["state"] == "SETTLED" and claimable(c, TENANT) == DEPOSIT
        assert lease(c, lid)["settled_how"] == "NO_CLAIMS" and conserved(c, lid)

    def test_before_the_period_ends_only_the_landlord_closes_claims(self, module, c):
        lid, _ = moved_out(module, c)
        as_(module, TENANT)
        with pytest.raises(err(module), match="only the landlord can close"):
            c.close_claims(lid)

    def test_the_tenant_draws_the_released_deposit(self, module, c):
        lid, _ = moved_out(module, c)
        as_(module, LANDLORD)
        c.close_claims(lid)
        as_(module, TENANT)
        assert json.loads(c.claim())["claimed_wei"] == str(DEPOSIT)
        assert transfers() == [{"to": TENANT, "wei": DEPOSIT}]
        with pytest.raises(err(module), match="nothing is owed"):
            c.claim()


class TestAnswers:
    def responding(self, module, c, n=2):
        lid, _ = moved_out(module, c)
        for room in ("R1", "R2", "R3")[:n]:
            deduct(module, c, lid, room, GEN)
        as_(module, LANDLORD)
        c.close_claims(lid)
        return lid

    def test_an_accepted_deduction_is_the_landlords_at_once(self, module, c):
        lid = self.responding(module, c)
        as_(module, TENANT)
        assert json.loads(c.answer_deduction(lid, "D1", True, "", b""))["state"] == "ACCEPTED"
        assert claimable(c, LANDLORD) == GEN
        with pytest.raises(err(module), match="already been answered"):
            c.answer_deduction(lid, "D1", False, "changed my mind", b"")

    def test_a_dispute_carries_a_statement_and_an_optional_photograph(self, module, c):
        lid = self.responding(module, c)
        as_(module, TENANT)
        c.answer_deduction(lid, "D1", False, "That mark was there at move-in.", jfif(b"mine"))
        d = lease(c, lid)["deductions"][0]
        assert d["state"] == "DISPUTED" and d["statement"] and d["answer_photo"]
        assert c.get_item_text(d["statement"]) == "That mark was there at move-in."
        assert json.loads(c.get_item(d["answer_photo"]))["phase"] == "RESPONSE"
        with pytest.raises(err(module), match="say why"):
            c.answer_deduction(lid, "D2", False, "", b"")

    def test_only_the_tenant_answers_and_only_in_the_response_period(self, module, c):
        lid = self.responding(module, c)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="only the tenant"):
            c.answer_deduction(lid, "D1", True, "", b"")
        set_now("2026-10-01T10:00:01Z")
        as_(module, TENANT)
        with pytest.raises(err(module), match="response period has ended"):
            c.answer_deduction(lid, "D1", True, "", b"")

    def test_an_unanswered_deduction_counts_as_accepted(self, module, c):
        lid = self.responding(module, c)
        as_(module, TENANT)
        c.answer_deduction(lid, "D1", False, "Not mine.", b"")
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="only the tenant can close"):
            c.close_responses(lid)
        set_now("2026-10-01T10:00:01Z")
        out = json.loads(c.close_responses(lid))
        assert out["state"] == "AWAITING_RULING"
        assert [d["state"] for d in lease(c, lid)["deductions"]] == ["DISPUTED", "ACCEPTED"]
        assert claimable(c, LANDLORD) == GEN
        assert lease(c, lid)["ruling_long_stop"] == "2026-10-01T13:00:01Z"

    def test_everything_accepted_settles(self, module, c):
        lid = self.responding(module, c)
        as_(module, TENANT)
        c.answer_deduction(lid, "D1", True, "", b"")
        out = json.loads(c.close_responses(lid))
        assert out["state"] == "SETTLED" and lease(c, lid)["settled_how"] == "AGREED"
        assert claimable(c, LANDLORD) == 2 * GEN and claimable(c, TENANT) == 3 * GEN
        assert conserved(c, lid)


class TestConcessions:
    def test_the_landlord_gives_up_a_disputed_deduction(self, module, c):
        lid, _, _ = disputed(module, c, n=2)
        as_(module, LANDLORD)
        out = json.loads(c.withdraw_deduction(lid, "D1"))
        assert out["state"] == "WITHDRAWN" and out["lease_state"] == "AWAITING_RULING"
        assert claimable(c, TENANT) == 3 * GEN + GEN
        out = json.loads(c.withdraw_deduction(lid, "D2"))
        assert out["lease_state"] == "SETTLED" and claimable(c, TENANT) == DEPOSIT
        assert lease(c, lid)["settled_how"] == "CONCEDED" and conserved(c, lid)

    def test_the_tenant_gives_up_a_disputed_deduction(self, module, c):
        lid, _, _ = disputed(module, c, n=1)
        as_(module, TENANT)
        out = json.loads(c.concede_deduction(lid, "D1"))
        assert out["lease_state"] == "SETTLED" and claimable(c, LANDLORD) == GEN
        with pytest.raises(err(module), match="while the lease is settled"):
            c.concede_deduction(lid, "D1")

    def test_neither_side_gives_up_the_others_deduction(self, module, c):
        lid, _, _ = disputed(module, c, n=1)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="only the tenant"):
            c.concede_deduction(lid, "D1")
        as_(module, TENANT)
        with pytest.raises(err(module), match="only the landlord"):
            c.withdraw_deduction(lid, "D1")

    def test_a_settled_deduction_cannot_be_given_up(self, module, c):
        lid, _, _ = disputed(module, c, n=2)
        as_(module, TENANT)
        c.concede_deduction(lid, "D1")
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="already settled"):
            c.withdraw_deduction(lid, "D1")
