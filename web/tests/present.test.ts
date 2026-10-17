import { describe, expect, it } from "vitest";

import {
  day, deductionName, finding, gen, humanize, itemName, leaseName, leaseState, moment, refusal,
  settledHow, span, toWei, writeOut,
} from "@/lib/present";
import { FINDINGS, LEASE_STATES } from "@/lib/types";

const RAW = /[A-Z]{2,}_[A-Z]|ev-\d|ls-\d|\bD\d\b|\bundefined\b|\bnull\b|\(s\)/;

describe("no machine word reaches a page", () => {
  it("names every lease state and every finding in words", () => {
    for (const s of LEASE_STATES) expect(leaseState(s)).not.toMatch(RAW);
    for (const f of FINDINGS) expect(finding(f)).not.toMatch(RAW);
    for (const h of ["NO_CLAIMS", "AGREED", "CONCEDED", "RULING", "UNRESOLVED", "APPEAL", "APPEAL_LAPSED"]) {
      expect(settledHow(h)).not.toMatch(RAW);
      expect(settledHow(h)).toMatch(/\.$/);
    }
  });
  it("writes ids out", () => {
    expect(leaseName("ls-00012")).toBe("Lease 12");
    expect(deductionName({ id: "D2" })).toBe("Deduction 2");
    expect(itemName({ item_id: "ev-000007", kind: "PHOTO" })).toBe("Photograph 7");
    expect(itemName({ item_id: "ev-000008", kind: "NOTE" })).toBe("Note 8");
    const items = [{ item_id: "ev-000004", kind: "PHOTO" as const }, { item_id: "ev-000005", kind: "NOTE" as const }];
    expect(writeOut("D1 rests on ev-000004 and ev-000005, not ev-000099", items))
      .toBe("deduction 1 rests on photograph 4 and note 5, not item 99");
  });
  it("falls back to words for an unknown value", () => {
    expect(humanize("SOMETHING_NEW")).toBe("Something new");
  });
});

describe("money", () => {
  it("prints GEN to four places with no trailing zeros", () => {
    expect(gen("0")).toBe("0");
    expect(gen(10n ** 18n)).toBe("1");
    expect(gen(15n * 10n ** 17n)).toBe("1.5");
    expect(gen(5n * 10n ** 16n)).toBe("0.05");
    expect(gen(12345n * 10n ** 18n)).toBe("12,345");
    expect(gen("garbage")).toBe("0");
  });
  it("reads a typed amount exactly", () => {
    expect(toWei("1.5")).toBe(15n * 10n ** 17n);
    expect(toWei("0.000000000000000001")).toBe(1n);
    expect(toWei("1.")).toBeNull();
    expect(toWei("-1")).toBeNull();
    expect(toWei("abc")).toBeNull();
  });
});

describe("time", () => {
  it("spells dates by hand in UTC", () => {
    expect(day("2026-10-01T23:30:00Z")).toBe("1 Oct 2026");
    expect(moment("2026-10-01T09:05:00Z")).toBe("1 Oct 2026, 09:05 UTC");
    expect(day("")).toBe("");
  });
  it("says spans in the unit a person would", () => {
    expect(span(30)).toBe("30 seconds");
    expect(span(600)).toBe("10 minutes");
    expect(span(3600)).toBe("1 hour");
    expect(span(5400)).toBe("90 minutes");
    expect(span(86400)).toBe("1 day");
    expect(span(7200)).toBe("2 hours");
    expect(span(14 * 86400)).toBe("14 days");
  });
});

describe("refusals", () => {
  it("drops the machine tag and keeps the contract's sentence", () => {
    expect(refusal("[EXPECTED] the claims period has ended")).toBe("The claims period has ended.");
    expect(refusal("UserError('[EXPECTED] only the tenant answers a deduction')")).toBe("Only the tenant answers a deduction.");
    expect(refusal("")).toBe("The contract refused it.");
  });
});
