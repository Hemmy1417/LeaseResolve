/**
 * The shapes the contract's views return, field for field. Each one names the
 * contract function that writes it; nothing here is invented by the app.
 */

export type Role = "LANDLORD" | "TENANT";

/** LEASE_STATES in contracts/leaseresolve.py. */
export const LEASE_STATES = [
  "OFFERED", "CHECK_IN", "TENANCY", "MOVE_OUT", "RESPONSE", "AWAITING_RULING",
  "RULED", "APPEALED", "SETTLED", "CANCELLED",
] as const;
export type LeaseState = (typeof LEASE_STATES)[number];

/** DEDUCTION_STATES. */
export const DEDUCTION_STATES = [
  "CLAIMED", "ACCEPTED", "DISPUTED", "WITHDRAWN", "CONCEDED", "SETTLED",
] as const;
export type DeductionState = (typeof DEDUCTION_STATES)[number];

/** FINDINGS. */
export const FINDINGS = [
  "TENANT_DAMAGE", "PRE_EXISTING", "FAIR_WEAR", "REPORTED_UNREPAIRED", "NOT_SHOWN",
] as const;
export type Finding = (typeof FINDINGS)[number];

/** PHASES. */
export const PHASES = ["BASELINE", "NOTICE", "MOVE_OUT", "RESPONSE", "APPEAL"] as const;
export type Phase = (typeof PHASES)[number];

export type SettledHow =
  | "" | "NO_CLAIMS" | "AGREED" | "CONCEDED" | "RULING" | "UNRESOLVED" | "APPEAL"
  | "APPEAL_LAPSED";

export interface Room { id: string; name: string }
export interface Clause { id: string; text: string }
export interface Windows { check_in: number; claims: number; response: number; appeal: number }

/** One deduction, as file_deduction writes it and later acts amend it. */
export interface Deduction {
  id: string;
  room_id: string;
  description: string;
  amount_wei: string;
  photo: string;
  state: DeductionState;
  statement: string;
  answer_photo: string;
  /** "", "LANDLORD", "TENANT" or "SPLIT" once it is paid. */
  paid_to: string;
  filed_at: string;
  /** Set by request_ruling and decide_appeal: who the standing ruling gives it to. */
  ruled_to?: Role;
}

/** The appeal, as _open_appeal writes it; decide/lapse/concession set result. */
export interface Appeal {
  by: Role;
  reason: string;
  bond_wei: string;
  /** The deductions the standing ruling gave against the appellant, fixed at filing. */
  contested: string[];
  opened_at: string;
  evidence_ends: string;
  lapse_at: string;
  result: "" | "MOVED" | "UPHELD" | "LAPSED";
  round?: number;
}

/** _file writes this for every photograph and note. */
export interface Item {
  item_id: string;
  lease_id: string;
  kind: "PHOTO" | "NOTE";
  phase: Phase;
  role: Role;
  room_id: string;
  deduction_id: string;
  caption: string;
  sha256: string;
  size: number;
  at: string;
  by: string;
}

/** A round's record, as _record writes it. */
export interface RoundRow {
  id: string;
  room_id: string;
  finding: Finding;
  /** True for tenant damage, which validators bind; a tenant-side label is the leader's reading. */
  finding_bound: boolean;
  to: Role;
  amount_wei: string;
  basis: string[];
  note: string;
}
export interface Round {
  n: number;
  kind: "RULING" | "APPEAL";
  at: string;
  ruleset: string;
  deductions: RoundRow[];
  unread: string[];
  reasoning: string;
  read: { item_id: string; kind: "PHOTO" | "NOTE"; phase: Phase; role: Role; room_id: string; sha256: string }[];
  new_items: string[];
  baseline_digest: string;
  appeal_by?: Role;
  reason?: string;
}

/** get_lease: create_lease's record plus items, rounds and the bond. */
export interface Lease {
  lease_id: string;
  title: string;
  property: string;
  landlord: string;
  tenant: string;
  deposit_wei: string;
  ends_at: string;
  rooms: Room[];
  clauses: Clause[];
  wear_rule: string;
  windows: Windows;
  state: LeaseState;
  created_at: string;
  accepted_at: string;
  item_ids: string[];
  deductions: Deduction[];
  held_wei: string;
  paid_landlord_wei: string;
  paid_tenant_wei: string;
  released_wei: string;
  round_count: number;
  standing_round: number;
  check_in_ends: string;
  baseline_digest: string;
  baseline_frozen_at: string;
  tenancy_ended_at: string;
  claims_ends: string;
  response_ends: string;
  ruling_long_stop: string;
  appeal_ends: string;
  appeal: Appeal | null;
  settled_at: string;
  settled_how: SettledHow;
  /** Only in get_lease. */
  items: Item[];
  rounds: Round[];
  appeal_bond_wei: string;
}

export type LeaseRow = Omit<Lease, "items" | "rounds" | "appeal_bond_wei">;
export interface LeaseList { total: number; leases: LeaseRow[] }
export interface Balance { claimable: string; claimed: string }
export interface Stats {
  lease: string; item: string; round: string; settled: string; held_wei: string; paid_wei: string;
}
export interface Config {
  ruleset: string;
  deployer: string;
  max_rooms: number;
  max_clauses: number;
  max_deductions: number;
  max_notices: number;
  appeal_items_per_party: { PHOTO: number; NOTE: number };
  min_deposit_wei: string;
  min_window_seconds: number;
  max_window_seconds: number;
  max_term_days: number;
  long_stop_windows: number;
  appeal_bond_bps: number;
  min_appeal_bond_wei: string;
  max_image_bytes: number;
  note_max: number;
  clause_max: number;
  title_max: number;
  name_max: number;
  line_max: number;
}
export interface EventRow { n: number; kind: string; detail: string; at: string; by: string }
export interface EventsPage { total: number; events: EventRow[] }
