import { describe, expect, it } from "vitest";

import { actsFor, claimRoom, roleOf, waitingOn, type ActId } from "@/lib/acts";
import { LEASE_STATES } from "@/lib/types";

import { at, deduction, GEN, item, iso, LANDLORD, offered, ruled, STRANGER, T0, TENANT } from "./fixtures";

const H = 3600_000;
const ids = (acts: ReturnType<typeof actsFor>) => acts.map((a) => a.id);
const ready = (acts: ReturnType<typeof actsFor>, id: ActId, deduction?: string) =>
  acts.find((a) => a.id === id && (deduction === undefined || a.deduction === deduction))?.ready;

describe("roles", () => {
  it("matches parties case-insensitively, and a stranger is no party", () => {
    const l = offered();
    expect(roleOf(l, LANDLORD.toLowerCase())).toBe("LANDLORD");
    expect(roleOf(l, TENANT)).toBe("TENANT");
    expect(roleOf(l, STRANGER)).toBe("");
    expect(roleOf(l, "")).toBe("");
  });
});

describe("every state answers for every viewer without throwing", () => {
  for (const s of LEASE_STATES) {
    for (const who of [LANDLORD, TENANT, STRANGER, ""]) {
      it(`${s} for ${who || "nobody"}`, () => {
        const l = at(s, s === "APPEALED" ? {
          appeal: { by: "TENANT", reason: "r", bond_wei: "1", contested: ["D1"], opened_at: iso(T0), evidence_ends: iso(T0 + H), lapse_at: iso(T0 + 4 * H), result: "" },
        } : {});
        expect(() => actsFor(l, who, T0)).not.toThrow();
        expect(waitingOn(l, T0)).not.toBe("");
        if (!who) expect(actsFor(l, who, T0)).toEqual([]);
      });
    }
  }
});

describe("the offer", () => {
  it("lets the landlord photograph rooms and withdraw, and the tenant accept", () => {
    expect(ids(actsFor(offered(), LANDLORD, T0))).toEqual(["baseline_photo", "baseline_note", "cancel_lease"]);
    expect(ids(actsFor(offered(), TENANT, T0))).toEqual(["accept_lease"]);
    expect(actsFor(offered(), STRANGER, T0)).toEqual([]);
  });

  it("stops offering a baseline photograph once every room has the landlord's", () => {
    const l = offered({ items: [item(1, { room_id: "R1" }), item(2, { room_id: "R2" })] });
    expect(ready(actsFor(l, LANDLORD, T0), "baseline_photo")).toBe(false);
    expect(ready(actsFor(l, LANDLORD, T0), "baseline_note")).toBe(true);
  });
});

describe("check-in (accept_lease sets check_in_ends)", () => {
  const l = at("CHECK_IN");
  it("lets both sides add to the baseline until it closes", () => {
    expect(ready(actsFor(l, TENANT, T0 + H), "baseline_photo")).toBe(true);
    expect(ready(actsFor(l, TENANT, T0 + H + 1), "baseline_photo")).toBe(false);
    expect(ready(actsFor(l, LANDLORD, T0 + H + 1), "baseline_note")).toBe(false);
  });
  it("lets the tenant close the baseline at any time and anyone else only after the period", () => {
    expect(ready(actsFor(l, TENANT, T0), "confirm_baseline")).toBe(true);
    expect(ready(actsFor(l, LANDLORD, T0 + H), "confirm_baseline")).toBe(false);
    expect(ready(actsFor(l, STRANGER, T0 + H + 1), "confirm_baseline")).toBe(true);
  });
  it("counts a tenant's own filings, never the landlord's, against the tenant", () => {
    const filled = at("CHECK_IN", { items: [item(1, { room_id: "R1" }), item(2, { room_id: "R2" })] });
    expect(ready(actsFor(filled, TENANT, T0), "baseline_photo")).toBe(true);
  });
});

describe("tenancy (confirm_baseline)", () => {
  const l = at("TENANCY");
  it("lets the tenant report repairs and move out", () => {
    expect(ids(actsFor(l, TENANT, T0))).toEqual(["notice", "end_tenancy"]);
  });
  it("caps repair notices at six", () => {
    const six = at("TENANCY", { items: [1, 2, 3, 4, 5, 6].map((n) => item(n, { kind: "NOTE", phase: "NOTICE", role: "TENANT" })) });
    expect(ready(actsFor(six, TENANT, T0), "notice")).toBe(false);
  });
  it("lets anyone end it only after the term", () => {
    const end = Date.parse(l.ends_at);
    expect(ready(actsFor(l, LANDLORD, end), "end_tenancy")).toBe(false);
    expect(ready(actsFor(l, LANDLORD, end + 1), "end_tenancy")).toBe(true);
  });
});

describe("move-out (end_tenancy sets claims_ends)", () => {
  it("lets the landlord claim up to three deductions inside the period", () => {
    const l = at("MOVE_OUT");
    expect(ready(actsFor(l, LANDLORD, T0 + H), "file_deduction")).toBe(true);
    expect(ready(actsFor(l, LANDLORD, T0 + H + 1), "file_deduction")).toBe(false);
    const three = at("MOVE_OUT", { deductions: [deduction("D1"), deduction("D2"), deduction("D3")] });
    expect(ready(actsFor(three, LANDLORD, T0), "file_deduction")).toBe(false);
    const withdrawn = at("MOVE_OUT", { deductions: [deduction("D1", { state: "WITHDRAWN" }), deduction("D2"), deduction("D3")] });
    expect(ready(actsFor(withdrawn, LANDLORD, T0), "file_deduction")).toBe(true);
  });
  it("stops when the deductions take the whole deposit", () => {
    const full = at("MOVE_OUT", { deductions: [deduction("D1", { amount_wei: (5n * GEN).toString() })] });
    expect(claimRoom(full)).toBe(0n);
    expect(ready(actsFor(full, LANDLORD, T0), "file_deduction")).toBe(false);
  });
  it("lets the landlord close claims at once and anyone after the period", () => {
    const l = at("MOVE_OUT");
    expect(ready(actsFor(l, LANDLORD, T0), "close_claims")).toBe(true);
    expect(ready(actsFor(l, TENANT, T0 + H), "close_claims")).toBe(false);
    expect(ready(actsFor(l, STRANGER, T0 + H + 1), "close_claims")).toBe(true);
  });
});

describe("answers (close_claims sets response_ends)", () => {
  const l = at("RESPONSE", { deductions: [deduction("D1"), deduction("D2", { state: "DISPUTED" })] });
  it("offers the tenant an answer for each claimed deduction only", () => {
    const acts = actsFor(l, TENANT, T0);
    expect(acts.filter((a) => a.id === "answer_deduction").map((a) => a.deduction)).toEqual(["D1"]);
    expect(ready(actsFor(l, TENANT, T0 + H + 1), "answer_deduction")).toBe(false);
  });
  it("lets the tenant give up a disputed deduction and the landlord withdraw a claimed one", () => {
    expect(ready(actsFor(l, TENANT, T0), "concede_deduction", "D2")).toBe(true);
    expect(ready(actsFor(l, LANDLORD, T0), "withdraw_deduction", "D1")).toBe(true);
  });
  it("lets the tenant close answers at once and anyone after the period", () => {
    expect(ready(actsFor(l, TENANT, T0), "close_responses")).toBe(true);
    expect(ready(actsFor(l, LANDLORD, T0 + H), "close_responses")).toBe(false);
    expect(ready(actsFor(l, LANDLORD, T0 + H + 1), "close_responses")).toBe(true);
  });
});

describe("awaiting a ruling (close_responses sets ruling_long_stop)", () => {
  const l = at("AWAITING_RULING", { deductions: [deduction("D1", { state: "DISPUTED" })] });
  it("lets either party ask for a ruling, never a stranger", () => {
    expect(ready(actsFor(l, LANDLORD, T0), "request_ruling")).toBe(true);
    expect(ready(actsFor(l, TENANT, T0), "request_ruling")).toBe(true);
    expect(ids(actsFor(l, STRANGER, T0))).not.toContain("request_ruling");
  });
  it("opens the long stop to anyone only after it passes", () => {
    expect(ready(actsFor(l, STRANGER, T0 + 3 * H), "settle_unresolved")).toBe(false);
    expect(ready(actsFor(l, STRANGER, T0 + 3 * H + 1), "settle_unresolved")).toBe(true);
  });
  it("lets the landlord withdraw and the tenant concede", () => {
    expect(ready(actsFor(l, LANDLORD, T0), "withdraw_deduction", "D1")).toBe(true);
    expect(ready(actsFor(l, TENANT, T0), "concede_deduction", "D1")).toBe(true);
  });
});

describe("ruled (request_ruling sets ruled_to and appeal_ends)", () => {
  it("offers an appeal only to a party the ruling went against on something", () => {
    const l = ruled(["LANDLORD", "LANDLORD"]);
    expect(ready(actsFor(l, TENANT, T0), "open_appeal")).toBe(true);
    expect(ready(actsFor(l, LANDLORD, T0), "open_appeal")).toBe(false);
    const split = ruled(["LANDLORD", "TENANT"]);
    expect(ready(actsFor(split, LANDLORD, T0), "open_appeal")).toBe(true);
    expect(ready(actsFor(split, TENANT, T0), "open_appeal")).toBe(true);
  });
  it("closes the appeal and opens settlement at the same boundary", () => {
    const l = ruled(["LANDLORD", "TENANT"]);
    expect(ready(actsFor(l, TENANT, T0 + H), "open_appeal")).toBe(true);
    expect(ready(actsFor(l, TENANT, T0 + H), "finalize")).toBe(false);
    expect(ready(actsFor(l, TENANT, T0 + H + 1), "open_appeal")).toBe(false);
    expect(ready(actsFor(l, STRANGER, T0 + H + 1), "finalize")).toBe(true);
  });
});

describe("appealed (_open_appeal)", () => {
  const appeal = { by: "TENANT" as const, reason: "r", bond_wei: "1", contested: ["D1"], opened_at: iso(T0), evidence_ends: iso(T0 + H), lapse_at: iso(T0 + 4 * H), result: "" as const };
  const l = ruled(["LANDLORD", "TENANT"], { state: "APPEALED", appeal });
  it("offers no concession or withdrawal while the appeal is pending", () => {
    for (const who of [LANDLORD, TENANT]) {
      const acts = ids(actsFor(l, who, T0));
      expect(acts).not.toContain("concede_deduction");
      expect(acts).not.toContain("withdraw_deduction");
    }
  });
  it("takes evidence until the period ends, then a decision", () => {
    expect(ready(actsFor(l, LANDLORD, T0 + H), "appeal_photo")).toBe(true);
    expect(ready(actsFor(l, LANDLORD, T0 + H), "decide_appeal")).toBe(false);
    expect(ready(actsFor(l, LANDLORD, T0 + H + 1), "appeal_note")).toBe(false);
    expect(ready(actsFor(l, LANDLORD, T0 + H + 1), "decide_appeal")).toBe(true);
  });
  it("counts each side's appeal filings against that side only", () => {
    const filed = { ...l, items: [item(20, { phase: "APPEAL", role: "TENANT", deduction_id: "D1" })] };
    expect(ready(actsFor(filed, TENANT, T0), "appeal_photo")).toBe(false);
    expect(ready(actsFor(filed, LANDLORD, T0), "appeal_photo")).toBe(true);
  });
  it("opens the lapse to anyone only after the long stop", () => {
    expect(ready(actsFor(l, STRANGER, T0 + 4 * H), "lapse_appeal")).toBe(false);
    expect(ready(actsFor(l, STRANGER, T0 + 4 * H + 1), "lapse_appeal")).toBe(true);
  });
});

describe("closed leases", () => {
  it("offer nothing to anyone", () => {
    for (const s of ["SETTLED", "CANCELLED"] as const) {
      for (const who of [LANDLORD, TENANT, STRANGER]) expect(actsFor(at(s), who, T0)).toEqual([]);
    }
  });
});
