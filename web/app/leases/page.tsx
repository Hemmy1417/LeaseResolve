"use client";

import { useState } from "react";

import { Loading, PillLink, Problem } from "@/components/bits";
import { LeaseRow } from "@/components/LeaseRow";
import { roleOf } from "@/lib/acts";
import { CONTRACT_CONFIGURED } from "@/lib/config";
import { plural, role } from "@/lib/present";
import { leasesOf, listLeases } from "@/lib/read";
import { useChain } from "@/lib/useChain";
import { useWallet } from "@/lib/wallet";

export default function LeasesPage() {
  const wallet = useWallet();
  const [mine, setMine] = useState(false);
  const showMine = mine && !!wallet.address;
  const list = useChain(
    CONTRACT_CONFIGURED ? (showMine ? `of.${wallet.address}` : "list") : null,
    (fresh) => (showMine ? leasesOf(wallet.address, 0, 50, fresh) : listLeases(0, 50, fresh)),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="display type-heading-3xl">Leases</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-pill bg-limestone p-1">
            {[false, true].map((m) => (
              <button
                key={String(m)}
                type="button"
                disabled={m && !wallet.address}
                onClick={() => setMine(m)}
                className={`rounded-pill px-4 py-2 text-[15px] disabled:opacity-40 ${showMine === m ? "bg-obsidian text-chalk" : ""}`}
              >
                {m ? "Mine" : "All"}
              </button>
            ))}
          </div>
          <PillLink href="/leases/new" variant="primary">Offer a lease</PillLink>
        </div>
      </div>

      {!CONTRACT_CONFIGURED ? (
        <Problem title="No deployment configured">This build does not name a contract to read.</Problem>
      ) : list.loading ? (
        <Loading what="the leases" />
      ) : list.error ? (
        <Problem title="The chain did not answer">
          {list.error instanceof Error ? list.error.message : "Reload in a moment."}
        </Problem>
      ) : (
        <>
          <p className="text-[15px] text-basalt">{plural(list.data?.total ?? 0, "lease")}{showMine ? " you are a party to" : " on this deployment"}, newest first.</p>
          <div className="flex flex-col gap-3">
            {(list.data?.leases ?? []).map((l) => {
              const r = roleOf(l, wallet.address);
              return <LeaseRow key={l.lease_id} lease={l} you={r ? `You are the ${role(r).toLowerCase()}` : undefined} />;
            })}
            {list.data?.leases.length === 0 ? (
              <p className="rounded-card bg-limestone p-8 text-[16px]">
                {showMine ? "This wallet is not a party to any lease yet." : "No lease has been offered yet."}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
