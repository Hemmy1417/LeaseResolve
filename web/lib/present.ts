/**
 * Every word a person reads passes through here. The contract speaks in
 * SCREAMING_SNAKE because a state machine should; a page should not. This is
 * the one place machine vocabulary becomes sentences, so no screen can go
 * wrong on its own and a change of wording is a change to one file.
 *
 * The rule: identifiers, addresses, digests and raw enum names never appear
 * in reading flow. They live in the record views, where a reader has asked to
 * see exactly what was stored.
 */
import type { Deduction, Finding, Item, Lease, LeaseState, Phase, Role, Room, SettledHow } from "./types";

/** TENANT_DAMAGE becomes "Tenant damage". A fallback, never a substitute for a map. */
export function humanize(value: string): string {
  const t = String(value ?? "").trim();
  if (!t) return "";
  const spaced = t.replace(/[_-]+/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function label(map: Record<string, string>, key: string | null | undefined): string {
  const k = String(key ?? "").trim();
  if (!k) return "";
  return map[k] ?? humanize(k);
}

const LEASE_STATE: Record<LeaseState, string> = {
  OFFERED: "Offered",
  CHECK_IN: "Checking in",
  TENANCY: "Tenancy",
  MOVE_OUT: "Moved out",
  RESPONSE: "Answering claims",
  AWAITING_RULING: "Awaiting a ruling",
  RULED: "Ruled",
  APPEALED: "Under appeal",
  SETTLED: "Settled",
  CANCELLED: "Withdrawn",
};
export const leaseState = (s: string) => label(LEASE_STATE, s);

/** The six stages of the track along the top of a lease. */
export const STAGES: { key: string; title: string; states: LeaseState[] }[] = [
  { key: "offer", title: "Offer", states: ["OFFERED"] },
  { key: "baseline", title: "Baseline", states: ["CHECK_IN"] },
  { key: "tenancy", title: "Tenancy", states: ["TENANCY"] },
  { key: "claims", title: "Claims", states: ["MOVE_OUT", "RESPONSE"] },
  { key: "ruling", title: "Ruling", states: ["AWAITING_RULING", "RULED", "APPEALED"] },
  { key: "settled", title: "Settled", states: ["SETTLED"] },
];
export function stageIndex(state: LeaseState): number {
  if (state === "CANCELLED") return 0;
  return Math.max(0, STAGES.findIndex((s) => s.states.includes(state)));
}

const FINDING: Record<Finding, string> = {
  TENANT_DAMAGE: "Tenant damage",
  PRE_EXISTING: "Already there at move-in",
  FAIR_WEAR: "Fair wear and tear",
  REPORTED_UNREPAIRED: "Reported, never repaired",
  NOT_SHOWN: "Not shown",
};
export const finding = (s: string) => label(FINDING, s);

const FINDING_SAID: Record<Finding, string> = {
  TENANT_DAMAGE:
    "The move-out photograph shows damage the move-in photograph of the same room does not, beyond fair wear and tear.",
  PRE_EXISTING: "The move-in record of this room already shows the condition.",
  FAIR_WEAR: "The condition is ordinary wear that the lease's own rule allows.",
  REPORTED_UNREPAIRED: "The tenant reported this during the tenancy and it was not repaired.",
  NOT_SHOWN: "The evidence does not establish the claim, so the deposit stays the tenant's.",
};
export const findingSaid = (s: string) => label(FINDING_SAID, s);

const DEDUCTION_STATE: Record<string, string> = {
  CLAIMED: "Claimed",
  ACCEPTED: "Accepted by the tenant",
  DISPUTED: "Disputed",
  WITHDRAWN: "Withdrawn by the landlord",
  CONCEDED: "Conceded by the tenant",
  SETTLED: "Settled",
};
export const deductionState = (s: string) => label(DEDUCTION_STATE, s);

const SETTLED_HOW: Record<Exclude<SettledHow, "">, string> = {
  NO_CLAIMS: "No deductions were claimed, so the whole deposit went back.",
  AGREED: "Every deduction was accepted or conceded.",
  CONCEDED: "The remaining disputes were given up.",
  RULING: "Settled on the ruling, with no appeal.",
  UNRESOLVED: "No ruling could be obtained in time, so each disputed deduction was split evenly.",
  APPEAL: "Settled on the appeal's ruling.",
  APPEAL_LAPSED: "The appeal could not be decided in time, so the first ruling stood.",
};
export const settledHow = (s: string) => label(SETTLED_HOW, s);

const ROLE: Record<Role, string> = { LANDLORD: "Landlord", TENANT: "Tenant" };
export const role = (s: string) => label(ROLE, s);
export const roleLower = (s: string) => role(s).toLowerCase();

const PHASE: Record<Phase, string> = {
  BASELINE: "Move-in",
  NOTICE: "Repair notice",
  MOVE_OUT: "Move-out",
  RESPONSE: "Tenant's answer",
  APPEAL: "Filed for the appeal",
};
export const phase = (s: string) => label(PHASE, s);

const APPEAL_RESULT: Record<string, string> = {
  MOVED: "The appeal moved at least one deduction, so the bond went back.",
  UPHELD: "The appeal moved nothing, so the bond went to the other side.",
  LAPSED: "The appeal lapsed; the first ruling stood and the bond went back.",
};
export const appealResult = (s: string) => label(APPEAL_RESULT, s);

/* ── numbers ── */

const WEI = 10n ** 18n;

/** Wei as GEN for reading: up to four decimals, trailing zeros dropped. */
export function gen(wei: string | bigint | number | null | undefined): string {
  let v: bigint;
  try {
    v = BigInt(wei ?? 0);
  } catch {
    return "0";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = v / WEI;
  const frac = ((v % WEI) * 10_000n) / WEI;
  const fracText = frac === 0n ? "" : `.${frac.toString().padStart(4, "0").replace(/0+$/, "")}`;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-GB")}${fracText}`;
}

export const genText = (wei: string | bigint | number) => `${gen(wei)} GEN`;

/** "1.5" GEN typed by a person, to wei. Null when it is not a number. */
export function toWei(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w ?? "0") * WEI + BigInt((f + "0".repeat(18)).slice(0, 18));
}

export function plural(n: number, word: string, many?: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? word : many ?? `${word}s`}`;
}

/* ── dates and windows ── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Oct 2026", spelled by hand so every browser writes the same thing. */
export function day(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1 Oct 2026, 09:00 UTC". Chain times are UTC and are said to be. */
export function moment(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day(iso)}, ${hh}:${mm} UTC`;
}

/** "2 hours", "45 minutes", "3 days": a span for a sentence. */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 2 * 86400 || (s >= 86400 && s % 86400 === 0)) return plural(Math.round(s / 86400), "day");
  if (s >= 2 * 3600 || (s >= 3600 && s % 3600 === 0)) return plural(Math.round(s / 3600), "hour");
  if (s >= 120) return plural(Math.round(s / 60), "minute");
  return plural(s, "second");
}

/** "in 40 minutes" or "40 minutes ago", against a clock. */
export function until(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return "";
  const d = (t - nowMs) / 1000;
  return d >= 0 ? `in ${span(d)}` : `${span(-d)} ago`;
}

/* ── the lease's own vocabulary ── */

export function roomName(lease: Pick<Lease, "rooms">, roomId: string): string {
  return lease.rooms.find((r: Room) => r.id === roomId)?.name ?? "A room";
}

/** "Deduction 2", never "D2". */
export function deductionName(d: Pick<Deduction, "id">): string {
  return `Deduction ${d.id.replace(/^D/, "")}`;
}

/** "Lease 12", never "ls-00012". */
export function leaseName(lid: string): string {
  const n = Number(lid.replace(/^ls-0*/, ""));
  return Number.isFinite(n) && n > 0 ? `Lease ${n}` : "A lease";
}

/** "Photograph 7" / "Note 8", never "ev-000007". */
export function itemName(it: Pick<Item, "item_id" | "kind">): string {
  const n = Number(it.item_id.replace(/^ev-0*/, ""));
  return `${it.kind === "PHOTO" ? "Photograph" : "Note"} ${Number.isFinite(n) ? n : ""}`.trim();
}

/** A short address for the record views only. */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** The contract's refusal, without its machine tag. */
export function refusal(text: string): string {
  const t = String(text ?? "")
    .replace(/\[EXPECTED\]\s*/g, "")
    .replace(/\[LLM_ERROR\]\s*/g, "")
    .replace(/^.*?UserError\(['"]?/, "")
    .replace(/['"]?\)\s*$/, "")
    .trim();
  if (!t) return "The contract refused it.";
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** First letter up, full stop at the end: a model's or a kit's words as a sentence. */
export function prose(text: string): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * A panel's or a party's words with item and deduction ids written out:
 * "ev-000004" becomes "photograph 4" (or "note 4"), "D2" becomes
 * "deduction 2". Anything not in the lease's items is left as it is.
 */
export function writeOut(text: string, items: Pick<Item, "item_id" | "kind">[]): string {
  const kinds = new Map(items.map((i) => [i.item_id, i.kind]));
  return String(text ?? "")
    .replace(/\bev-0*(\d+)\b/g, (m, n: string) => {
      const kind = kinds.get(m);
      return kind ? `${kind === "PHOTO" ? "photograph" : "note"} ${n}` : `item ${n}`;
    })
    .replace(/\bD(\d)\b/g, (_m, n: string) => `deduction ${n}`);
}
