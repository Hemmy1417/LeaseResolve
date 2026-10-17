"""The offer, the deposit and the baseline: who may do what, and when."""
import json

import pytest

from conftest import (  # noqa: F401
    DEPOSIT, GEN, LANDLORD, STRANGER, TENANT, accept, as_, claimable, conserved, err,
    exif_jpeg, in_tenancy, jfif, lease, lease_params, note, offered, photo, png, set_now,
)


class TestTheOffer:
    def test_an_offer_records_the_landlord_as_the_signer(self, module, c):
        lid = offered(module, c)
        l = lease(c, lid)
        assert l["landlord"] == LANDLORD and l["tenant"] == TENANT
        assert l["state"] == "OFFERED" and l["held_wei"] == "0"
        assert [r["id"] for r in l["rooms"]] == ["R1", "R2", "R3"]
        assert [k["id"] for k in l["clauses"]] == ["K1", "K2"]

    @pytest.mark.parametrize("over,words", [
        ({"title": ""}, "title"),
        ({"property": " "}, "property"),
        ({"tenant": "nobody"}, "wallet address"),
        ({"tenant": LANDLORD}, "another wallet"),
        ({"deposit_wei": "0"}, "more than zero"),
        ({"deposit_wei": "abc"}, "whole number"),
        ({"deposit_wei": str(10**15)}, "at least"),
        ({"ends_at": "2020-01-01T00:00:00Z"}, "in the future"),
        ({"ends_at": "2035-01-01T00:00:00Z"}, "at most"),
        ({"ends_at": "soon"}, "date and time"),
        ({"rooms": []}, "at least one room"),
        ({"rooms": [{"name": "A"}] * 7}, "at most 6 rooms"),
        ({"rooms": [{"name": "Hall"}, {"name": "hall"}]}, "both called"),
        ({"rooms": [{"name": ""}]}, "needs a name"),
        ({"clauses": ["x"] * 7}, "at most 6 clauses"),
        ({"clauses": [""]}, "is empty"),
        ({"clauses": "one"}, "must be a list"),
        ({"wear_rule": ""}, "wear and tear"),
        ({"windows": {"check_in": 10, "claims": 3600, "response": 3600, "appeal": 3600}},
         "between 600 seconds"),
        ({"windows": {"claims": 3600}}, "check-in window"),
        ({"windows": None}, "four windows"),
    ])
    def test_a_bad_offer_is_refused_in_words(self, module, c, over, words):
        as_(module, LANDLORD)
        with pytest.raises(err(module), match=words):
            c.create_lease(lease_params(**over))

    def test_an_offer_that_is_not_json_is_refused(self, module, c):
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="must be JSON"):
            c.create_lease("{")
        with pytest.raises(err(module), match="JSON object"):
            c.create_lease("[1]")

    def test_only_the_landlord_withdraws_an_open_offer(self, module, c):
        lid = offered(module, c)
        as_(module, TENANT)
        with pytest.raises(err(module), match="only the landlord"):
            c.cancel_lease(lid)
        as_(module, LANDLORD)
        assert json.loads(c.cancel_lease(lid))["state"] == "CANCELLED"
        assert accept(module, c, lid)["refused"] is True
        assert claimable(c, TENANT) == DEPOSIT, "a refused deposit is claimable back"

    def test_both_parties_find_the_lease_in_their_index(self, module, c):
        lid = offered(module, c)
        for who in (LANDLORD, TENANT):
            rows = json.loads(c.leases_of(who, 0, 10))
            assert rows["total"] == 1 and rows["leases"][0]["lease_id"] == lid
        assert json.loads(c.leases_of(STRANGER, 0, 10))["total"] == 0
        assert json.loads(c.list_leases(0, 10))["total"] == 1
        with pytest.raises(err(module), match="wallet address"):
            c.leases_of("0x12", 0, 10)


class TestTheDeposit:
    def test_the_tenant_pays_exactly_the_deposit(self, module, c):
        lid = offered(module, c)
        out = accept(module, c, lid)
        assert out["refused"] is False and out["state"] == "CHECK_IN"
        l = lease(c, lid)
        assert l["held_wei"] == str(DEPOSIT) and l["check_in_ends"] == "2026-10-01T10:00:00Z"
        assert conserved(c, lid)

    @pytest.mark.parametrize("who,wei,words", [
        (STRANGER, DEPOSIT, "only the tenant"),
        (LANDLORD, DEPOSIT, "only the tenant"),
        (TENANT, DEPOSIT - 1, "exactly the deposit"),
        (TENANT, DEPOSIT + 1, "exactly the deposit"),
        (TENANT, 0, "exactly the deposit"),
    ])
    def test_a_wrong_payment_is_refused_and_credited_back(self, module, c, who, wei, words):
        lid = offered(module, c)
        out = accept(module, c, lid, wei=wei, who=who)
        assert out["refused"] is True and words in out["reason"]
        assert claimable(c, who) == wei
        assert lease(c, lid)["state"] == "OFFERED" and lease(c, lid)["held_wei"] == "0"

    def test_an_unknown_lease_is_refused_and_credited_back(self, module, c):
        as_(module, TENANT, GEN)
        out = json.loads(c.accept_lease("ls-00099"))
        assert out["refused"] is True and "no lease" in out["reason"]
        assert claimable(c, TENANT) == GEN

    def test_a_second_payment_is_refused(self, module, c):
        lid = offered(module, c)
        accept(module, c, lid)
        out = accept(module, c, lid)
        assert out["refused"] is True and "no longer open" in out["reason"]
        assert claimable(c, TENANT) == DEPOSIT
        assert lease(c, lid)["held_wei"] == str(DEPOSIT)


class TestTheBaseline:
    def test_the_landlord_records_the_rooms_before_the_offer_is_taken(self, module, c):
        lid = offered(module, c)
        eid = photo(module, c, lid, LANDLORD, "R1")
        it = json.loads(c.get_item(eid))
        assert it["phase"] == "BASELINE" and it["role"] == "LANDLORD" and it["room_id"] == "R1"
        assert c.get_image(eid)[:4] == b"\xff\xd8\xff\xe0"

    def test_the_tenant_adds_to_the_baseline_only_after_paying(self, module, c):
        lid = offered(module, c)
        with pytest.raises(err(module), match="after accepting"):
            photo(module, c, lid, TENANT, "R1")
        accept(module, c, lid)
        assert json.loads(c.get_item(photo(module, c, lid, TENANT, "R1")))["role"] == "TENANT"

    def test_each_side_files_one_photograph_and_one_note_per_room(self, module, c):
        lid = offered(module, c)
        photo(module, c, lid, LANDLORD, "R1")
        note(module, c, lid, LANDLORD, "R1")
        with pytest.raises(err(module), match="already filed a baseline photograph"):
            photo(module, c, lid, LANDLORD, "R1", caption="again")
        with pytest.raises(err(module), match="already filed a baseline note"):
            note(module, c, lid, LANDLORD, "R1", text="again")
        accept(module, c, lid)
        # The landlord's filings never use up the tenant's.
        photo(module, c, lid, TENANT, "R1")
        note(module, c, lid, TENANT, "R1", text="There is a scuff by the door.")

    def test_a_stranger_files_nothing(self, module, c):
        lid = offered(module, c)
        with pytest.raises(err(module), match="only the landlord or the tenant"):
            photo(module, c, lid, STRANGER, "R1")

    def test_a_room_the_lease_does_not_name_is_refused(self, module, c):
        lid = offered(module, c)
        with pytest.raises(err(module), match="no room R9"):
            photo(module, c, lid, LANDLORD, "R9")

    @pytest.mark.parametrize("data,words", [
        (b"", "empty"),
        (b"GIF89a" + b"\x00" * 50, "PNG and JFIF JPEG only"),
        (None, "PNG and JFIF JPEG only"),
        (jfif(size=400_001), "at most 400,000 bytes"),
    ], ids=["empty", "gif", "exif", "too-big"])
    def test_a_file_the_runtime_cannot_read_is_refused(self, module, c, data, words):
        lid = offered(module, c)
        with pytest.raises(err(module), match=words):
            photo(module, c, lid, LANDLORD, "R1", data=exif_jpeg() if data is None else data)

    def test_a_png_is_taken(self, module, c):
        lid = offered(module, c)
        eid = photo(module, c, lid, LANDLORD, "R1", data=png(b"x"))
        assert json.loads(c.get_item(eid))["size"] > 0

    def test_an_empty_note_is_refused(self, module, c):
        lid = offered(module, c)
        with pytest.raises(err(module), match="note is empty"):
            note(module, c, lid, LANDLORD, "R1", text="  ")

    def test_bad_filing_details_are_refused(self, module, c):
        lid = offered(module, c)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="must be JSON"):
            c.file_note(lid, "{", "Some text here")
        with pytest.raises(err(module), match="JSON object"):
            c.file_note(lid, "[]", "Some text here")

    def test_the_baseline_closes_at_the_end_of_check_in(self, module, c):
        lid = offered(module, c)
        accept(module, c, lid)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="only the tenant can close"):
            c.confirm_baseline(lid)
        set_now("2026-10-01T10:00:01Z")
        with pytest.raises(err(module), match="check-in period has ended"):
            photo(module, c, lid, TENANT, "R1")
        as_(module, STRANGER)
        out = json.loads(c.confirm_baseline(lid))
        assert out["state"] == "TENANCY" and len(out["baseline_digest"]) == 64

    def test_the_tenant_may_close_the_baseline_early(self, module, c):
        lid, _ = in_tenancy(module, c)
        l = lease(c, lid)
        assert l["state"] == "TENANCY" and l["baseline_frozen_at"] == "2026-10-01T09:00:00Z"

    def test_the_digest_covers_every_baseline_item(self, module, c):
        a, _ = in_tenancy(module, c)
        b, _ = in_tenancy(module, c, tenant_photo=True)
        assert lease(c, a)["baseline_digest"] != lease(c, b)["baseline_digest"]

    def test_nothing_joins_the_baseline_once_it_is_frozen(self, module, c):
        lid, _ = in_tenancy(module, c)
        with pytest.raises(err(module), match="only a repair notice"):
            photo(module, c, lid, LANDLORD, "R1", caption="late")
        with pytest.raises(err(module), match="only a repair notice"):
            photo(module, c, lid, TENANT, "R1", caption="late")
        with pytest.raises(err(module), match="only a repair notice"):
            note(module, c, lid, LANDLORD, "R1")


class TestTheTenancy:
    def test_the_tenant_files_dated_repair_notices(self, module, c):
        lid, _ = in_tenancy(module, c)
        set_now("2027-02-01T08:00:00Z")
        eid = note(module, c, lid, TENANT, "R2", text="The sink trap is leaking under the basin.")
        it = json.loads(c.get_item(eid))
        assert it["phase"] == "NOTICE" and it["at"] == "2027-02-01T08:00:00Z"
        assert c.get_item_text(eid) == "The sink trap is leaking under the basin."
        with pytest.raises(err(module), match="is a photograph"):
            c.get_item_text(json.loads(c.get_lease(lid))["item_ids"][0])

    def test_notices_are_capped(self, module, c):
        lid, _ = in_tenancy(module, c)
        for i in range(6):
            note(module, c, lid, TENANT, "R2", text=f"Notice number {i}")
        with pytest.raises(err(module), match="at most 6 repair notices"):
            note(module, c, lid, TENANT, "R2", text="one more")

    def test_before_the_term_ends_only_the_tenant_ends_the_tenancy(self, module, c):
        lid, _ = in_tenancy(module, c)
        as_(module, LANDLORD)
        with pytest.raises(err(module), match="only the tenant can end"):
            c.end_tenancy(lid)
        set_now("2027-09-30T12:00:01Z")
        out = json.loads(c.end_tenancy(lid))
        assert out["state"] == "MOVE_OUT" and out["claims_ends"] == "2027-09-30T13:00:01Z"

    def test_the_tenancy_ends_only_once(self, module, c):
        lid, _ = in_tenancy(module, c)
        as_(module, TENANT)
        c.end_tenancy(lid)
        with pytest.raises(err(module), match="while the lease is move out"):
            c.end_tenancy(lid)
