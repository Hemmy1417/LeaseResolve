/**
 * Lease shapes exactly as the contract writes them, each builder naming the
 * contract function whose output it copies. A UI rule tested against a shape
 * the contract never produces proves nothing.
 */
import type { Deduction, Item, Lease, LeaseState, Role } from "@/lib/types";

export const LANDLORD = "0x691E25a08E00fa16fC95B159589Ba563727d77A8";
export const TENANT = "0x56E71175C0772A21a6170e3d95184f126526E9F2";
export const STRANGER = "0xd41fca7210904c6D2f4E00C377E76F8aAd43eC9e";
export const T0 = Date.parse("2026-10-01T09:00:00Z");
export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const GEN = 10n ** 18n;

/** create_lease, then get_lease's additions (items, rounds, appeal_bond_wei). */
export function offered(over: Partial<Lease> = {}): Lease {
  return {
    lease_id: "ls-00001", title: "Two-bedroom flat", property: "Flat 4B",
    landlord: LANDLORD, tenant: TENANT, deposit_wei: (5n * GEN).toString(),
    ends_at: "2027-09-30T12:00:00Z",
    rooms: [{ id: "R1", name: "Living room" }, { id: "R2", name: "Bathroom" }],
    clauses: [{ id: "K1", text: "Return it as found." }],
    wear_rule: "Light scuffs are fair wear.",
    windows: { check_in: 3600, claims: 3600, response: 3600, appeal: 3600 },
    state: "OFFERED", created_at: iso(T0), accepted_at: "", item_ids: [], deductions: [],
    held_wei: "0", paid_landlord_wei: "0", paid_tenant_wei: "0", released_wei: "0",
    round_count: 0, standing_round: 0, check_in_ends: "", baseline_digest: "",
    baseline_frozen_at: "", tenancy_ended_at: "", claims_ends: "", response_ends: "",
    ruling_long_stop: "", appeal_ends: "", appeal: null, settled_at: "", settled_how: "",
    items: [], rounds: [], appeal_bond_wei: (5n * 10n ** 16n).toString(),
    ...over,
  };
}

/** _file */
export function item(n: number, over: Partial<Item>): Item {
  return {
    item_id: `ev-${String(n).padStart(6, "0")}`, lease_id: "ls-00001", kind: "PHOTO", phase: "BASELINE",
    role: "LANDLORD", room_id: "R1", deduction_id: "", caption: "", sha256: "a".repeat(64), size: 4000,
    at: iso(T0), by: LANDLORD, ...over,
  };
}

/** file_deduction, then answer_deduction / request_ruling amend it. */
export function deduction(id: string, over: Partial<Deduction> = {}): Deduction {
  return {
    id, room_id: "R1", description: "Holes in the wall", amount_wei: GEN.toString(), photo: "ev-000009",
    state: "CLAIMED", statement: "", answer_photo: "", paid_to: "", filed_at: iso(T0), ...over,
  };
}

/** A lease in any state, with the timestamps the contract would have set. */
export function at(state: LeaseState, over: Partial<Lease> = {}): Lease {
  const h = 3600_000;
  const base = offered();
  const s: Partial<Lease> = { state };
  if (state !== "OFFERED" && state !== "CANCELLED") {
    Object.assign(s, { accepted_at: iso(T0), check_in_ends: iso(T0 + h), held_wei: base.deposit_wei });
  }
  if (["TENANCY", "MOVE_OUT", "RESPONSE", "AWAITING_RULING", "RULED", "APPEALED", "SETTLED"].includes(state)) {
    Object.assign(s, { baseline_digest: "b".repeat(64), baseline_frozen_at: iso(T0) });
  }
  if (["MOVE_OUT", "RESPONSE", "AWAITING_RULING", "RULED", "APPEALED", "SETTLED"].includes(state)) {
    Object.assign(s, { tenancy_ended_at: iso(T0), claims_ends: iso(T0 + h) });
  }
  if (["RESPONSE", "AWAITING_RULING", "RULED", "APPEALED"].includes(state)) {
    Object.assign(s, { response_ends: iso(T0 + h) });
  }
  if (["AWAITING_RULING", "RULED", "APPEALED"].includes(state)) {
    Object.assign(s, { ruling_long_stop: iso(T0 + 3 * h) });
  }
  if (["RULED", "APPEALED"].includes(state)) Object.assign(s, { appeal_ends: iso(T0 + h), standing_round: 1, round_count: 1 });
  return offered({ ...s, ...over });
}

/** request_ruling's effect on two disputed deductions. */
export function ruled(to: [Role, Role], over: Partial<Lease> = {}): Lease {
  return at("RULED", {
    deductions: [
      deduction("D1", { state: "DISPUTED", ruled_to: to[0], statement: "ev-000010" }),
      deduction("D2", { room_id: "R2", state: "DISPUTED", ruled_to: to[1], statement: "ev-000011" }),
    ],
    ...over,
  });
}
