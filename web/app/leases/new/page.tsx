"use client";

/**
 * The landlord's offer. Everything here is frozen into the lease when it is
 * created: the tenant, the deposit, the rooms, the clauses, the fair-wear rule
 * and the four windows. The baseline photographs come next, on the lease page,
 * before the tenant pays anything.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Card, Dotted, Tag } from "@/components/bits";
import { TxPanel, type TxOutcome } from "@/components/TxPanel";
import { CONTRACT_ADDRESS } from "@/lib/config";
import { useTransactionKit } from "@/lib/kit";
import { genText, span, toWei } from "@/lib/present";
import { returnedJson } from "@/lib/receipt";
import { accountOf, useWallet } from "@/lib/wallet";

const PACES = [
  { key: "demo", label: "Demonstration", says: "Ten minutes a window, to walk a whole lease in an hour.", seconds: 600 },
  { key: "short", label: "A day", says: "A day for each window.", seconds: 86400 },
  { key: "real", label: "Two weeks", says: "Fourteen days for each window, as a real tenancy would want.", seconds: 14 * 86400 },
];

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-[15px]">{children}</span>
      {hint ? <span className="text-[13px] text-basalt">{hint}</span> : null}
    </span>
  );
}

function inAYear(): string {
  const d = new Date(Date.now() + 365 * 86400_000);
  return d.toISOString().slice(0, 10);
}

export default function NewLease() {
  const wallet = useWallet();
  const kit = useTransactionKit();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [property, setProperty] = useState("");
  const [tenant, setTenant] = useState("");
  const [deposit, setDeposit] = useState("");
  const [ends, setEnds] = useState(inAYear);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [rooms, setRooms] = useState<string[]>(["Living room", "Kitchen", "Bathroom"]);
  const [clauses, setClauses] = useState<string[]>([
    "The tenant returns the property in the condition recorded at move-in, fair wear and tear excepted.",
    "The landlord repairs faults the tenant reports in writing.",
  ]);
  const [wear, setWear] = useState("Light scuffs, faded paint, worn carpet and loose fittings from normal daily living are fair wear and tear.");
  const [pace, setPace] = useState("demo");
  const [signing, setSigning] = useState(false);
  const [failed, setFailed] = useState("");

  const seconds = PACES.find((p) => p.key === pace)?.seconds ?? 600;
  const depositWei = toWei(deposit);
  const tenantAddr = accountOf(tenant.trim());

  const problems = [
    !title.trim() && "Give the lease a title.",
    !property.trim() && "Name the property.",
    !tenantAddr && "Enter the tenant's wallet address.",
    tenantAddr && wallet.address && tenantAddr.toLowerCase() === wallet.address.toLowerCase() && "The tenant must be another wallet.",
    (!depositWei || depositWei < 10n ** 16n) && "The deposit must be at least 0.01 GEN.",
    rooms.filter((r) => r.trim()).length === 0 && "Name at least one room.",
    new Set(rooms.map((r) => r.trim().toLowerCase())).size !== rooms.length && "Two rooms share a name.",
    !wear.trim() && "State the fair-wear rule.",
    !(/^\d{4}-\d{2}-\d{2}$/.test(ends) && ends > today) && "The term must end after today.",
  ].filter(Boolean) as string[];

  const leaseJson = useMemo(() => JSON.stringify({
    title: title.trim(), property: property.trim(), tenant: tenantAddr,
    deposit_wei: (depositWei ?? 0n).toString(), ends_at: `${ends}T12:00:00Z`,
    rooms: rooms.map((name) => ({ name: name.trim() })).filter((r) => r.name),
    clauses: clauses.map((c) => c.trim()).filter(Boolean), wear_rule: wear.trim(),
    windows: { check_in: seconds, claims: seconds, response: seconds, appeal: seconds },
  }), [title, property, tenantAddr, depositWei, ends, rooms, clauses, wear, seconds]);

  const tx = useMemo(
    () => ({ kind: "write" as const, address: CONTRACT_ADDRESS, method: "create_lease", args: [leaseJson] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signing],
  );

  async function done(o: TxOutcome) {
    if (!o.successful || !o.hash) return;
    const out = await returnedJson<{ lease_id?: string }>(o.hash).catch(() => null);
    if (out?.lease_id) router.push(`/leases/${out.lease_id}`);
    else setFailed("The lease was created, but its number could not be read from the receipt. Find it under Leases.");
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Tag>For the landlord</Tag>
        <h1 className="display type-heading-3xl mt-4 max-w-[18ch]">Offer a lease</h1>
        <p className="mt-3 max-w-[60ch] text-[17px]">
          Everything on this page is frozen into the lease. Next you photograph each room for the
          baseline; the tenant sees it before paying the deposit.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="flex flex-col gap-6">
          <label className="flex flex-col gap-2"><Label>Title</Label>
            <input className="field" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Two-bedroom flat, Lekki Phase 1" />
          </label>
          <label className="flex flex-col gap-2"><Label>Property</Label>
            <input className="field" maxLength={200} value={property} onChange={(e) => setProperty(e.target.value)} placeholder="Flat 4B, 12 Admiralty Way" />
          </label>
          <label className="flex flex-col gap-2"><Label hint="The tenant pays the deposit from this wallet.">Tenant&apos;s wallet</Label>
            <input className="field mono" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="0x…" />
          </label>
          <div className="grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-2"><Label>Deposit, in GEN</Label>
              <input className="field figure" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="2" />
            </label>
            <label className="flex flex-col gap-2"><Label>The term ends</Label>
              <input className="field" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </label>
          </div>

          <Dotted />
          <div className="flex flex-col gap-3">
            <Label hint="Up to six. Each gets its own move-in record.">Rooms</Label>
            {rooms.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input className="field" maxLength={60} value={r} onChange={(e) => setRooms(rooms.map((x, j) => (j === i ? e.target.value : x)))} />
                <Button variant="ghost" aria-label={`Remove ${r || "this room"}`} disabled={rooms.length === 1} onClick={() => setRooms(rooms.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            {rooms.length < 6 ? <div><Button variant="secondary" onClick={() => setRooms([...rooms, ""])}>Add a room</Button></div> : null}
          </div>

          <Dotted />
          <div className="flex flex-col gap-3">
            <Label hint="Up to six. The validators read them when they rule.">Clauses</Label>
            {clauses.map((c, i) => (
              <div key={i} className="flex gap-2">
                <textarea className="field" maxLength={400} value={c} onChange={(e) => setClauses(clauses.map((x, j) => (j === i ? e.target.value : x)))} />
                <Button variant="ghost" onClick={() => setClauses(clauses.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            {clauses.length < 6 ? <div><Button variant="secondary" onClick={() => setClauses([...clauses, ""])}>Add a clause</Button></div> : null}
          </div>
          <label className="flex flex-col gap-2"><Label hint="What counts as ordinary wear rather than damage. A ruling applies it.">Fair wear and tear</Label>
            <textarea className="field" maxLength={400} value={wear} onChange={(e) => setWear(e.target.value)} />
          </label>

          <Dotted />
          <div className="flex flex-col gap-3">
            <Label hint="Check-in, claims, answers and appeal each last this long.">Pace</Label>
            <div className="grid gap-2 md:grid-cols-3">
              {PACES.map((p) => (
                <button key={p.key} type="button" onClick={() => setPace(p.key)}
                  className={`rounded-[24px] p-4 text-left ${pace === p.key ? "bg-obsidian text-chalk" : "bg-pumice"}`}>
                  <span className="display block text-[28px] leading-none">{p.label}</span>
                  <span className="mt-1 block text-[13px] opacity-80">{p.says}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <aside className="on-dark flex flex-col gap-4 rounded-card bg-obsidian p-7 text-chalk lg:sticky lg:top-28">
          <p className="display text-[40px] leading-none">The offer</p>
          <dl className="flex flex-col gap-2 text-[15px]">
            <div className="flex justify-between gap-3"><dt className="text-chalk/70">Deposit</dt><dd>{depositWei ? genText(depositWei) : "Not set"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-chalk/70">Rooms</dt><dd>{rooms.filter((r) => r.trim()).length}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-chalk/70">Each window</dt><dd>{span(seconds)}</dd></div>
          </dl>
          {!wallet.address ? (
            <p className="text-[14px]">Connect the landlord&apos;s wallet to make the offer.</p>
          ) : signing && kit ? (
            <TxPanel kit={kit} tx={tx} confirmText="Make the offer" onDone={(o) => void done(o)} onClose={() => setSigning(false)} />
          ) : (
            <>
              <Button disabled={problems.length > 0 || !kit} onClick={() => setSigning(true)}>Review and sign</Button>
              {problems.length ? (
                <ul className="flex flex-col gap-1 text-[13px] text-chalk/70">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : null}
            </>
          )}
          {failed ? <p className="text-[14px]">{failed}</p> : null}
        </aside>
      </div>
    </div>
  );
}
