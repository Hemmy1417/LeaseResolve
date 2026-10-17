/**
 * The exact contract call each act sends. Pure, so tests/calls.test.ts can
 * check every one against the deployed contract's own schema: a contract call
 * is an untyped array, and nothing else would notice an argument too many.
 */
import { METHOD, type ActId } from "./acts";

export interface Call {
  method: string;
  args: unknown[];
  /** Wei sent with the call; only the two payable writes send any. */
  value?: bigint;
}

export interface Inputs {
  roomId?: string;
  deductionId?: string;
  caption?: string;
  text?: string;
  photo?: Uint8Array;
  amountWei?: bigint;
  accept?: boolean;
  valueWei?: bigint;
}

const EMPTY = new Uint8Array(0);

export function callFor(act: ActId, lid: string, i: Inputs = {}): Call {
  const method = METHOD[act];
  const meta = (deduction = "") =>
    JSON.stringify({ room_id: i.roomId ?? "", deduction_id: deduction, caption: i.caption ?? "" });
  switch (act) {
    case "accept_lease":
      return { method, args: [lid], value: i.valueWei ?? 0n };
    case "open_appeal":
      return { method, args: [lid, i.text ?? ""], value: i.valueWei ?? 0n };
    case "baseline_photo":
      return { method, args: [lid, meta(), i.photo ?? EMPTY] };
    case "appeal_photo":
      return { method, args: [lid, meta(i.deductionId ?? ""), i.photo ?? EMPTY] };
    case "baseline_note":
    case "notice":
      return { method, args: [lid, meta(), i.text ?? ""] };
    case "appeal_note":
      return { method, args: [lid, meta(i.deductionId ?? ""), i.text ?? ""] };
    case "file_deduction":
      return {
        method,
        args: [lid, i.roomId ?? "", i.text ?? "", (i.amountWei ?? 0n).toString(), i.photo ?? EMPTY],
      };
    case "answer_deduction":
      return {
        method,
        args: [lid, i.deductionId ?? "", !!i.accept, i.accept ? "" : i.text ?? "", i.accept ? EMPTY : i.photo ?? EMPTY],
      };
    case "withdraw_deduction":
    case "concede_deduction":
      return { method, args: [lid, i.deductionId ?? ""] };
    default:
      return { method, args: [lid] };
  }
}

/** The writes that send value: they answer a refusal by returning, not by failing. */
export const PAYABLE = new Set(["accept_lease", "open_appeal"]);

/** The writes a round of validators decides, which take minutes rather than seconds. */
export const ROUNDS = new Set(["request_ruling", "decide_appeal"]);
