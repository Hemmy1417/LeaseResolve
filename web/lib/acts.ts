/**
 * What a viewer can do on a lease, right now, and why not when they cannot.
 *
 * Pure: a function of the lease, the viewer's address and a clock. Every rule
 * mirrors a check the contract makes in the write it names, so an act the
 * contract would refuse is never offered as a button that fails; it is listed
 * with the reason, in words. tests/acts.test.ts walks every state, role and
 * both sides of every window against shapes copied from the contract.
 */
import { sameAddress } from "./chain";
import { deductionName, roomName, span } from "./present";
import type { Deduction, Lease, Role } from "./types";

export type ActId =
  | "cancel_lease" | "accept_lease" | "baseline_photo" | "baseline_note" | "confirm_baseline"
  | "notice" | "end_tenancy" | "file_deduction" | "withdraw_deduction" | "close_claims"
  | "answer_deduction" | "concede_deduction" | "close_responses" | "request_ruling"
  | "settle_unresolved" | "finalize" | "open_appeal" | "appeal_photo" | "appeal_note"
  | "decide_appeal" | "lapse_appeal";

/** The contract method each act sends. */
export const METHOD: Record<ActId, string> = {
  cancel_lease: "cancel_lease",
  accept_lease: "accept_lease",
  baseline_photo: "file_photo",
  baseline_note: "file_note",
  confirm_baseline: "confirm_baseline",
  notice: "file_note",
  end_tenancy: "end_tenancy",
  file_deduction: "file_deduction",
  withdraw_deduction: "withdraw_deduction",
  close_claims: "close_claims",
  answer_deduction: "answer_deduction",
  concede_deduction: "concede_deduction",
  close_responses: "close_responses",
  request_ruling: "request_ruling",
  settle_unresolved: "settle_unresolved",
  finalize: "finalize",
  open_appeal: "open_appeal",
  appeal_photo: "file_photo",
  appeal_note: "file_note",
  decide_appeal: "decide_appeal",
  lapse_appeal: "lapse_appeal",
};

export interface Act {
  id: ActId;
  /** A deduction this act is about, when it is about one. */
  deduction?: string;
  title: string;
  ready: boolean;
  /** Why it is not ready, as a sentence; empty when ready. */
  why: string;
}

/** The limits the contract enforces, from get_config (constants in the contract). */
export const LIMITS = { maxDeductions: 3, maxNotices: 6, appealPhotos: 1, appealNotes: 2 };

const OPEN_TO_CONCESSION = ["RESPONSE", "AWAITING_RULING", "RULED"];

export function roleOf(lease: Pick<Lease, "landlord" | "tenant">, address: string): Role | "" {
  if (sameAddress(address, lease.landlord)) return "LANDLORD";
  if (sameAddress(address, lease.tenant)) return "TENANT";
  return "";
}

const ms = (iso: string) => (iso ? new Date(iso).getTime() : NaN);

/** Strictly after a boundary, as the contract's `now > end` reads it. */
export const past = (iso: string, nowMs: number) => nowMs > ms(iso);

function opensIn(iso: string, nowMs: number, what: string): string {
  const left = (ms(iso) - nowMs) / 1000;
  return `${what} ${left > 0 ? `in ${span(left)}` : "about now"}.`;
}

/** Disputed deductions and who the standing ruling gives each to. */
export function standing(lease: Lease): Record<string, Role> {
  const out: Record<string, Role> = {};
  for (const d of lease.deductions) if (d.state === "DISPUTED" && d.ruled_to) out[d.id] = d.ruled_to;
  return out;
}

/** Baseline filings already made by a role for a room, by kind. */
export function baselineFiled(lease: Lease, who: Role, roomId: string, kind: "PHOTO" | "NOTE"): boolean {
  return lease.items.some((it) => it.phase === "BASELINE" && it.role === who && it.room_id === roomId && it.kind === kind);
}

/** Rooms where this role may still file a baseline item of this kind. */
export function baselineRooms(lease: Lease, who: Role, kind: "PHOTO" | "NOTE"): string[] {
  return lease.rooms.filter((r) => !baselineFiled(lease, who, r.id, kind)).map((r) => r.id);
}

export function appealFiled(lease: Lease, who: Role, kind: "PHOTO" | "NOTE"): number {
  return lease.items.filter((it) => it.phase === "APPEAL" && it.role === who && it.kind === kind).length;
}

export function liveDeductions(lease: Lease): Deduction[] {
  return lease.deductions.filter((d) => d.state !== "WITHDRAWN");
}

/** What the deductions still open leave room for, in wei. */
export function claimRoom(lease: Lease): bigint {
  return BigInt(lease.deposit_wei) - liveDeductions(lease).reduce((t, d) => t + BigInt(d.amount_wei), 0n);
}

/**
 * Every act this viewer can take or is waiting to take, in the order a page
 * should show them. Acts belonging only to the other party are not listed;
 * `waitingOn` says what the lease is waiting for instead.
 */
export function actsFor(lease: Lease, address: string, nowMs: number): Act[] {
  const me = roleOf(lease, address);
  const connected = !!address;
  const acts: Act[] = [];
  const add = (id: ActId, title: string, ready: boolean, why = "", deduction?: string) =>
    acts.push({ id, title, ready, why: ready ? "" : why, deduction });
  const s = lease.state;

  if (s === "OFFERED") {
    if (me === "LANDLORD") {
      add("baseline_photo", "Photograph a room for the baseline",
        baselineRooms(lease, "LANDLORD", "PHOTO").length > 0, "Every room already has your photograph.");
      add("baseline_note", "Describe a room's condition",
        baselineRooms(lease, "LANDLORD", "NOTE").length > 0, "Every room already has your note.");
      add("cancel_lease", "Withdraw the offer", true);
    }
    if (me === "TENANT") add("accept_lease", "Accept and pay the deposit", true);
  }

  if (s === "CHECK_IN") {
    const open = !past(lease.check_in_ends, nowMs);
    if (me) {
      add("baseline_photo", "Photograph a room for the baseline",
        open && baselineRooms(lease, me, "PHOTO").length > 0,
        open ? "Every room already has your photograph." : "The check-in period has ended.");
      add("baseline_note", "Describe a room's condition",
        open && baselineRooms(lease, me, "NOTE").length > 0,
        open ? "Every room already has your note." : "The check-in period has ended.");
    }
    if (me === "TENANT") add("confirm_baseline", "Close the baseline and start the tenancy", true);
    else if (connected) {
      add("confirm_baseline", "Close the baseline and start the tenancy", !open,
        opensIn(lease.check_in_ends, nowMs, "Before then only the tenant can close it. It opens to everyone"));
    }
  }

  if (s === "TENANCY") {
    if (me === "TENANT") {
      const notices = lease.items.filter((it) => it.phase === "NOTICE").length;
      add("notice", "Report a repair", notices < LIMITS.maxNotices,
        `A lease holds at most ${LIMITS.maxNotices} repair notices.`);
      add("end_tenancy", "Move out and end the tenancy", true);
    } else if (connected) {
      add("end_tenancy", "End the tenancy at the end of the term", past(lease.ends_at, nowMs),
        opensIn(lease.ends_at, nowMs, "Only the tenant can end it before the term runs out. The term ends"));
    }
  }

  if (s === "MOVE_OUT") {
    const open = !past(lease.claims_ends, nowMs);
    if (me === "LANDLORD") {
      const live = liveDeductions(lease).length;
      add("file_deduction", "Claim a deduction",
        open && live < LIMITS.maxDeductions && claimRoom(lease) > 0n,
        !open ? "The claims period has ended."
          : live >= LIMITS.maxDeductions ? `A lease takes at most ${LIMITS.maxDeductions} deductions.`
          : "The deductions already take the whole deposit.");
      for (const d of lease.deductions) {
        if (d.state === "CLAIMED") add("withdraw_deduction", `Withdraw ${deductionName(d).toLowerCase()}`, true, "", d.id);
      }
      add("close_claims", "Close claims and release the rest", true);
    } else if (connected) {
      add("close_claims", "Close claims and release the rest", !open,
        opensIn(lease.claims_ends, nowMs, "Before then only the landlord can close claims. It opens to everyone"));
    }
  }

  if (s === "RESPONSE") {
    const open = !past(lease.response_ends, nowMs);
    for (const d of lease.deductions) {
      if (d.state !== "CLAIMED") continue;
      if (me === "TENANT") {
        add("answer_deduction", `Answer ${deductionName(d).toLowerCase()} (${roomName(lease, d.room_id)})`, open,
          "The response period has ended; unanswered deductions count as accepted when it closes.", d.id);
      }
      if (me === "LANDLORD") add("withdraw_deduction", `Withdraw ${deductionName(d).toLowerCase()}`, true, "", d.id);
    }
    if (me === "TENANT") add("close_responses", "Close the response period", true);
    else if (connected) {
      add("close_responses", "Close the response period", !open,
        opensIn(lease.response_ends, nowMs, "Before then only the tenant can close it. It opens to everyone"));
    }
  }

  if (OPEN_TO_CONCESSION.includes(s)) {
    for (const d of lease.deductions) {
      if (d.state !== "DISPUTED") continue;
      if (me === "TENANT") add("concede_deduction", `Give up ${deductionName(d).toLowerCase()}`, true, "", d.id);
      if (me === "LANDLORD" && s !== "RESPONSE") {
        add("withdraw_deduction", `Withdraw ${deductionName(d).toLowerCase()}`, true, "", d.id);
      }
    }
  }

  if (s === "AWAITING_RULING") {
    if (me) add("request_ruling", "Ask the validators for a ruling", true);
    if (connected) {
      add("settle_unresolved", "Split what no ruling could settle", past(lease.ruling_long_stop, nowMs),
        opensIn(lease.ruling_long_stop, nowMs, "Only if no ruling is obtained. That opens"));
    }
  }

  if (s === "RULED") {
    const open = !past(lease.appeal_ends, nowMs);
    if (me) {
      const lost = Object.values(standing(lease)).some((to) => to !== me);
      add("open_appeal", "Appeal the ruling", open && lost,
        !open ? "The appeal window has closed." : "The ruling went your way on every deduction.");
    }
    if (connected) {
      add("finalize", "Settle on the ruling", !open,
        opensIn(lease.appeal_ends, nowMs, "The appeal window closes"));
    }
  }

  if (s === "APPEALED" && lease.appeal) {
    const a = lease.appeal;
    const open = !past(a.evidence_ends, nowMs);
    if (me) {
      add("appeal_photo", "File a photograph for the appeal",
        open && appealFiled(lease, me, "PHOTO") < LIMITS.appealPhotos,
        open ? `Each side files at most ${LIMITS.appealPhotos} photograph for an appeal.` : "The evidence period has ended.");
      add("appeal_note", "File a note for the appeal",
        open && appealFiled(lease, me, "NOTE") < LIMITS.appealNotes,
        open ? `Each side files at most ${LIMITS.appealNotes} notes for an appeal.` : "The evidence period has ended.");
      add("decide_appeal", "Ask the validators to decide the appeal", !open,
        opensIn(a.evidence_ends, nowMs, "The evidence period closes"));
    }
    if (connected) {
      add("lapse_appeal", "Settle on the first ruling", past(a.lapse_at, nowMs),
        opensIn(a.lapse_at, nowMs, "Only if the appeal is never decided. That opens"));
    }
  }

  return acts;
}

/** One sentence on what the lease is waiting for, for a viewer with nothing to do. */
export function waitingOn(lease: Lease, nowMs: number): string {
  switch (lease.state) {
    case "OFFERED": return "Waiting for the tenant to accept the offer and pay the deposit.";
    case "CHECK_IN": return `The baseline is open until the check-in period ends, ${span((ms(lease.check_in_ends) - nowMs) / 1000)} from now, or until the tenant closes it.`;
    case "TENANCY": return "The tenancy is under way. The tenant can file repair notices.";
    case "MOVE_OUT": return "The landlord is listing deductions.";
    case "RESPONSE": return "The tenant is answering the deductions.";
    case "AWAITING_RULING": return "Either party can ask the validators for a ruling.";
    case "RULED": return "The ruling stands unless appealed inside the window.";
    case "APPEALED": return "The appeal's evidence period is open to both sides.";
    case "SETTLED": return "Settled. Each party draws what it is owed from the balance in the wallet bar.";
    case "CANCELLED": return "The landlord withdrew this offer. Nothing was paid.";
    default: return "";
  }
}
