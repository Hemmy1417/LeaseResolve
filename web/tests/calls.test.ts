/**
 * Every call the interface composes, checked against the deployed contract's
 * own schema (lib/contract-schema.json, read from the deployment of record by
 * scripts/schema.mjs). A contract call is an untyped array: nothing else
 * notices an argument too many, a string where a bool belongs, or value sent
 * to a method that cannot take it.
 */
import { describe, expect, it } from "vitest";

import { METHOD, type ActId } from "@/lib/acts";
import { callFor, PAYABLE } from "@/lib/calls";
import schema from "@/lib/contract-schema.json";

type W = { params: string[]; types: string[]; payable: boolean };
const writes = schema.writes as Record<string, W>;
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function typeOk(type: string, v: unknown): boolean {
  if (type === "string") return typeof v === "string";
  if (type === "bool") return typeof v === "boolean";
  if (type === "bytes") return v instanceof Uint8Array;
  if (type === "int") return typeof v === "number" || typeof v === "bigint";
  return true;
}

const ALL = Object.keys(METHOD) as ActId[];

describe("composed calls match the deployed schema", () => {
  for (const act of ALL) {
    for (const accept of [true, false]) {
      it(`${act}${act === "answer_deduction" ? (accept ? " (accept)" : " (dispute)") : ""}`, () => {
        const call = callFor(act, "ls-00001", {
          roomId: "R1", deductionId: "D1", text: "words", caption: "c", photo,
          amountWei: 10n ** 17n, accept, valueWei: 1n,
        });
        const w = writes[call.method];
        expect(w, `${call.method} is not a write on the deployment`).toBeTruthy();
        expect(call.args.length).toBe(w!.params.length);
        call.args.forEach((a, i) => expect(typeOk(w!.types[i]!, a), `${call.method} arg ${i}`).toBe(true));
        expect(call.value !== undefined && call.value > 0n).toBe(w!.payable);
        expect(PAYABLE.has(act)).toBe(w!.payable);
        // JSON metadata arguments are JSON.
        if (call.method === "file_photo" || call.method === "file_note") {
          expect(() => JSON.parse(String(call.args[1]))).not.toThrow();
        }
      });
    }
  }
});

describe("coverage", () => {
  it("reaches every write the contract has, from the acts or the frame", () => {
    // create_lease is the offer page; claim is the claim bar.
    const reached = new Set([...Object.values(METHOD), "create_lease", "claim"]);
    expect([...reached].sort()).toEqual(Object.keys(writes).sort());
  });
});
