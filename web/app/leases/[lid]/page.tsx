"use client";

import { use } from "react";

import { Loading, PillLink, Problem } from "@/components/bits";
import { LeaseView } from "@/components/LeaseView";
import { getLease, ReadError } from "@/lib/read";
import { useChain } from "@/lib/useChain";

export default function LeasePage({ params }: { params: Promise<{ lid: string }> }) {
  const { lid } = use(params);
  const lease = useChain(`lease.${lid}`, (fresh) => getLease(lid, fresh));

  if (lease.loading) return <Loading what="the lease" />;
  if (lease.error) {
    const transient = lease.error instanceof ReadError && lease.error.transient;
    return (
      <Problem title={transient ? "The chain is busy" : "This lease could not be read"}>
        <p>{lease.error instanceof Error ? lease.error.message : "Reload in a moment."}</p>
        <div className="mt-5"><PillLink href="/leases">All leases</PillLink></div>
      </Problem>
    );
  }
  if (!lease.data) {
    return (
      <Problem title="There is no such lease">
        <p>Nothing on this deployment has that number.</p>
        <div className="mt-5"><PillLink href="/leases">All leases</PillLink></div>
      </Problem>
    );
  }
  return <LeaseView lease={lease.data} />;
}
