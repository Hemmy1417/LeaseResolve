import Link from "next/link";

import { Tag } from "./bits";
import { day, gen, leaseName, leaseState, plural } from "@/lib/present";
import type { LeaseRow as Row } from "@/lib/types";

/** One lease in a list: a limestone strip you can open. */
export function LeaseRow({ lease, you }: { lease: Row; you?: string }) {
  const disputed = lease.deductions.filter((d) => d.state === "DISPUTED").length;
  return (
    <Link
      href={`/leases/${lease.lease_id}`}
      className="grid items-center gap-4 rounded-card bg-limestone px-7 py-6 no-underline transition-colors hover:bg-chalk md:grid-cols-[1fr_auto_auto] md:px-9"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-basalt">{leaseName(lease.lease_id)}</span>
          <Tag tone={lease.state === "SETTLED" || lease.state === "CANCELLED" ? "plain" : "sulfur"}>{leaseState(lease.state)}</Tag>
          {you ? <Tag tone="dark">{you}</Tag> : null}
        </div>
        <p className="display mt-2 text-[32px] leading-none">{lease.title}</p>
        <p className="mt-1 text-[14px] text-basalt">
          {lease.property} · {plural(lease.rooms.length, "room")}
          {disputed ? ` · ${plural(disputed, "deduction")} in dispute` : ""}
        </p>
      </div>
      <p className="text-[13px] text-basalt md:text-right">Offered {day(lease.created_at)}</p>
      <p className="display figure text-[48px] leading-none md:text-right">
        {gen(lease.deposit_wei)}<span className="ml-1 text-[24px]">GEN</span>
      </p>
    </Link>
  );
}
