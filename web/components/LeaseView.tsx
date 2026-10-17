"use client";

/**
 * One lease, laid out the way the dispute is argued: the rooms, each with
 * what it looked like on move-in day beside what the landlord says it looks
 * like now; the deductions and what the validators found; and the record of
 * every round, with the digest of each thing it read.
 */
import { ActPanel } from "./ActPanel";
import { Card, Dotted, StoredPhoto, Tag, TextLink } from "./bits";
import { useEffect, useState } from "react";

import { roleOf } from "@/lib/acts";
import { addressUrl, sameAddress } from "@/lib/chain";
import {
  appealResult, day, deductionName, deductionState, finding, findingSaid, gen, genText, itemName,
  leaseName, leaseState, moment, phase, plural, prose, role as roleWord, roomName, settledHow,
  shortAddress, span, STAGES, stageIndex, until, writeOut,
} from "@/lib/present";
import { getEvents, getItemText } from "@/lib/read";
import type { Deduction, EventRow, Item, Lease, Round } from "@/lib/types";
import { useChain } from "@/lib/useChain";
import { useWallet } from "@/lib/wallet";

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function NoteText({ eid }: { eid: string }) {
  const t = useChain(`text.${eid}`, () => getItemText(eid));
  if (t.loading) return <span className="pulse text-ash">Reading the note.</span>;
  return <>{t.data ?? "This note could not be read."}</>;
}

function Party({ label, address, me }: { label: string; address: string; me: boolean }) {
  return (
    <div className="rounded-pill bg-limestone px-5 py-3">
      <span className="text-[13px] text-basalt">{label}</span>
      <span className="ml-3 text-[15px]">{me ? "You" : <span className="mono">{shortAddress(address)}</span>}</span>
    </div>
  );
}

function StageTrack({ lease, nowMs }: { lease: Lease; nowMs: number }) {
  const at = stageIndex(lease.state);
  const cancelled = lease.state === "CANCELLED";
  const when: Record<string, string> = {
    offer: day(lease.created_at),
    baseline: lease.accepted_at ? day(lease.accepted_at) : "",
    tenancy: lease.baseline_frozen_at ? day(lease.baseline_frozen_at) : "",
    claims: lease.tenancy_ended_at ? day(lease.tenancy_ended_at) : "",
    ruling: lease.rounds[0] ? day(lease.rounds[0].at) : "",
    settled: lease.settled_at ? day(lease.settled_at) : "",
  };
  const deadline: Partial<Record<string, string>> = {
    CHECK_IN: lease.check_in_ends, MOVE_OUT: lease.claims_ends, RESPONSE: lease.response_ends,
    AWAITING_RULING: lease.ruling_long_stop, RULED: lease.appeal_ends, APPEALED: lease.appeal?.evidence_ends,
  };
  const due = deadline[lease.state];
  const dueWord: Partial<Record<string, string>> = {
    CHECK_IN: "Check-in closes", MOVE_OUT: "Claims close", RESPONSE: "Answers close",
    AWAITING_RULING: "Long stop", RULED: "Appeal window closes", APPEALED: "Appeal evidence closes",
  };
  return (
    <div className="rounded-card bg-limestone p-6 md:p-8">
      <ol className="grid grid-cols-3 gap-y-6 md:grid-cols-6">
        {STAGES.map((s, i) => {
          const done = !cancelled && (i < at || lease.state === "SETTLED");
          const now = !cancelled && i === at && lease.state !== "SETTLED";
          return (
            <li key={s.key} className="pr-3">
              <span className={`display block text-[56px] leading-none md:text-[72px] ${now ? "text-ember" : done ? "text-obsidian" : "text-grout"}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={`mt-1 block text-[15px] ${now || done ? "text-obsidian" : "text-ash"}`}>{s.title}</span>
              <span className="block text-[12px] text-basalt">{when[s.key] || " "}</span>
            </li>
          );
        })}
      </ol>
      <Dotted className="mt-6" />
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[14px]">
        <Tag tone={lease.state === "SETTLED" ? "dark" : "sulfur"}>{leaseState(lease.state)}</Tag>
        {due ? (
          <span>{dueWord[lease.state]} {until(due, nowMs)}, <span className="text-basalt">{moment(due)}</span></span>
        ) : lease.state === "SETTLED" ? (
          <span>{settledHow(lease.settled_how)}</span>
        ) : lease.state === "TENANCY" ? (
          <span>The term ends {day(lease.ends_at)}.</span>
        ) : null}
      </div>
    </div>
  );
}

function Plate({ it, lease, label }: { it: Item; lease: Lease; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <StoredPhoto eid={it.item_id} sha256={it.sha256} alt={`${label}, ${roomName(lease, it.room_id)}`} className="aspect-[4/3] rounded-plate" />
      <p className="text-[13px] text-basalt">
        {label} · {roleWord(it.role)} · {day(it.at)}
        {it.caption ? <span className="block text-obsidian">{it.caption}</span> : null}
      </p>
    </div>
  );
}

function RoomCard({ lease, roomId }: { lease: Lease; roomId: string }) {
  const items = lease.items.filter((it) => it.room_id === roomId);
  const baselinePhotos = items.filter((it) => it.phase === "BASELINE" && it.kind === "PHOTO");
  const baselineNotes = items.filter((it) => it.phase === "BASELINE" && it.kind === "NOTE");
  const notices = items.filter((it) => it.phase === "NOTICE");
  const after = items.filter((it) => it.kind === "PHOTO" && it.phase !== "BASELINE");
  const name = roomName(lease, roomId);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="display type-heading-lg">{name}</h3>
        <span className="text-[13px] text-basalt">
          {plural(baselinePhotos.length, "move-in photograph")}
          {after.length ? ` · ${plural(after.length, "later photograph")}` : ""}
        </span>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-[14px]">On move-in day</p>
          <div className="mt-3 flex flex-col gap-4">
            {baselinePhotos.length === 0 ? (
              <p className="rounded-plate bg-pumice p-6 text-[14px] text-basalt">
                No photograph of this room is in the baseline. Damage here cannot be established against a before.
              </p>
            ) : baselinePhotos.map((it) => <Plate key={it.item_id} it={it} lease={lease} label="Move-in" />)}
            {baselineNotes.map((it) => (
              <blockquote key={it.item_id} className="rounded-[20px] bg-pumice p-4 text-[15px]">
                <NoteText eid={it.item_id} />
                <span className="mt-2 block text-[12px] text-basalt">{roleWord(it.role)}&apos;s note, {day(it.at)}</span>
              </blockquote>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[14px]">Since</p>
          <div className="mt-3 flex flex-col gap-4">
            {after.length === 0 && notices.length === 0 ? (
              <p className="rounded-plate bg-pumice p-6 text-[14px] text-basalt">Nothing filed about this room since move-in.</p>
            ) : null}
            {notices.map((it) => (
              <blockquote key={it.item_id} className="rounded-[20px] bg-sulfur p-4 text-[15px]">
                <span className="mb-1 block text-[12px]">Repair notice, {moment(it.at)}</span>
                <NoteText eid={it.item_id} />
              </blockquote>
            ))}
            {after.map((it) => <Plate key={it.item_id} it={it} lease={lease} label={phase(it.phase)} />)}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DeductionCard({ lease, d }: { lease: Lease; d: Deduction }) {
  const standing = lease.rounds.find((r) => r.n === lease.standing_round);
  const row = standing?.deductions.find((r) => r.id === d.id);
  const paid = d.paid_to === "LANDLORD" ? "Paid to the landlord"
    : d.paid_to === "TENANT" ? "Returned to the tenant"
    : d.paid_to === "SPLIT" ? "Split evenly" : "";
  return (
    <div className="rounded-card bg-limestone p-7 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[14px] text-basalt">{deductionName(d)} · {roomName(lease, d.room_id)}</p>
          <p className="display mt-2 text-[56px] leading-none">{gen(d.amount_wei)} GEN</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag tone={d.state === "DISPUTED" ? "sulfur" : "plain"}>{deductionState(d.state)}</Tag>
          {paid ? <Tag tone="dark">{paid}</Tag> : null}
        </div>
      </div>
      <p className="mt-4 max-w-[64ch] text-[16px]">“{d.description}”</p>
      {d.statement ? (
        <div className="mt-4 rounded-[20px] bg-pumice p-4 text-[15px]">
          <span className="mb-1 block text-[12px] text-basalt">The tenant&apos;s answer</span>
          <NoteText eid={d.statement} />
        </div>
      ) : null}
      {row ? (
        <div className={`mt-5 rounded-[24px] p-5 ${row.to === "LANDLORD" ? "bg-ember text-obsidian" : "bg-obsidian text-chalk"}`}>
          <p className="display text-[32px] leading-none">{row.finding_bound ? finding(row.finding) : "Not tenant damage"}</p>
          <p className="mt-2 text-[14px] opacity-85">
            {row.finding_bound
              ? findingSaid(row.finding)
              : `The validators agreed this is not tenant damage. The leading validator's reading: ${finding(row.finding).toLowerCase()}. ${findingSaid(row.finding)}`}
          </p>
          {row.note ? <p className="mt-3 text-[15px]">{prose(writeOut(row.note, lease.items))}</p> : null}
          <p className="mt-3 text-[13px] opacity-80">
            {row.to === "LANDLORD" ? "This ruling gives it to the landlord." : "This ruling returns it to the tenant."}
            {row.basis.length ? ` Rests on ${row.basis.map((e) => {
              const it = lease.items.find((x) => x.item_id === e);
              return it ? itemName(it).toLowerCase() : "an item";
            }).join(", ")}.` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RoundCard({ lease, r }: { lease: Lease; r: Round }) {
  return (
    <details className="group rounded-card bg-limestone p-7 md:p-8">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-3">
        <span className="display text-[32px] leading-none">
          {r.kind === "APPEAL" ? "Appeal ruling" : "Ruling"} {r.n}
        </span>
        <span className="text-[14px] text-basalt">{moment(r.at)} · <span className="group-open:hidden">Show the record</span><span className="hidden group-open:inline">Hide</span></span>
      </summary>
      {r.reason ? <p className="mt-4 text-[15px]">Appealed by the {roleWord(r.appeal_by ?? "").toLowerCase()}: “{r.reason}”</p> : null}
      {r.reasoning ? <p className="mt-4 max-w-[70ch] text-[15px] text-basalt">The leading validator&apos;s reasoning, in its own words: {prose(writeOut(r.reasoning, lease.items))}</p> : null}
      <ul className="mt-5 flex flex-col gap-2">
        {r.deductions.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-pill bg-pumice px-5 py-2 text-[14px]">
            <span>{deductionName(row)} · {roomName(lease, row.room_id)}</span>
            <span>
              {row.finding_bound ? finding(row.finding) : `Not tenant damage (leading reading: ${finding(row.finding).toLowerCase()})`}
              {" → "}{row.to === "LANDLORD" ? "landlord" : "tenant"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[14px]">What this round read, by digest</p>
      <ul className="mt-2 flex flex-col gap-1">
        {r.read.map((x) => (
          <li key={x.item_id} className="grid grid-cols-[110px_1fr] gap-3 text-[13px] md:grid-cols-[150px_200px_1fr]">
            <span>{itemName(x)}</span>
            <span className="hidden text-basalt md:block">{phase(x.phase)} · {roleWord(x.role)}{r.new_items.includes(x.item_id) ? " · new" : ""}</span>
            <span className="mono break-all text-basalt">{x.sha256}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-basalt">Baseline digest <span className="mono break-all">{r.baseline_digest}</span></p>
    </details>
  );
}

const EVENT: Record<string, string> = {
  OFFERED: "Offered", CANCELLED: "Offer withdrawn", DEPOSIT_PAID: "Deposit paid",
  BASELINE_PHOTO: "Move-in photograph filed", BASELINE_NOTE: "Move-in note filed",
  BASELINE_FROZEN: "Baseline frozen", NOTICE_NOTE: "Repair notice filed",
  TENANCY_ENDED: "Tenancy ended", DEDUCTION_CLAIMED: "Deduction claimed",
  DEDUCTION_WITHDRAWN: "Deduction withdrawn", CLAIMS_CLOSED: "Claims closed",
  DEDUCTION_ACCEPTED: "Deduction accepted", DEDUCTION_DISPUTED: "Deduction disputed",
  DEDUCTION_CONCEDED: "Deduction conceded", RESPONSES_CLOSED: "Answers closed",
  RULED: "Ruled", APPEALED: "Appealed", APPEAL_PHOTO: "Appeal photograph filed",
  APPEAL_NOTE: "Appeal note filed", SETTLED: "Settled",
};

function Activity({ lease }: { lease: Lease }) {
  const ev = useChain(`events.${lease.lease_id}.${lease.item_ids.length}.${lease.state}`, () => getEvents(lease.lease_id, 0, 40));
  const rows: EventRow[] = ev.data?.events ?? [];
  return (
    <Card>
      <h3 className="display type-heading-lg">Activity</h3>
      {ev.loading ? <p className="pulse mt-4 text-[14px] text-basalt">Reading the activity.</p> : (
        <ol className="mt-5 flex flex-col">
          {rows.map((e) => (
            <li key={e.n} className="grid grid-cols-[1fr_auto] gap-3 border-t-[1.5px] border-dotted border-obsidian/40 py-3 text-[15px] first:border-t-0">
              <span>{EVENT[e.kind] ?? prose(e.kind.replace(/_/g, " ").toLowerCase())}{e.kind === "SETTLED" && e.detail ? `: ${settledHow(e.detail).replace(/\.$/, "").toLowerCase()}` : ""}</span>
              <span className="text-[13px] text-basalt">{moment(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function LeaseView({ lease }: { lease: Lease }) {
  const wallet = useWallet();
  const nowMs = useNow();
  const me = roleOf(lease, wallet.address);
  const live = lease.deductions.filter((d) => d.state !== "WITHDRAWN" || d.paid_to);
  const rooms = lease.rooms.map((r) => r.id);
  const paidOut = BigInt(lease.paid_landlord_wei) + BigInt(lease.paid_tenant_wei);

  return (
    <div className="flex flex-col gap-6">
      <header className="grid gap-6 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap gap-2">
            <Tag>{leaseName(lease.lease_id)}</Tag>
            <Tag tone="plain">{plural(lease.rooms.length, "room")}</Tag>
          </div>
          <h1 className="display type-heading-3xl mt-4 max-w-[16ch]">{lease.title}</h1>
          <p className="mt-3 text-[18px]">{lease.property}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Party label="Landlord" address={lease.landlord} me={sameAddress(wallet.address, lease.landlord)} />
            <Party label="Tenant" address={lease.tenant} me={sameAddress(wallet.address, lease.tenant)} />
          </div>
        </div>
        <div className="grid min-w-[280px] grid-cols-2 gap-3 lg:grid-cols-1">
          <div className="rounded-card bg-ember p-6 text-chalk md:p-7">
            <p className="text-[14px]">Deposit</p>
            <p className="display figure mt-2 text-[72px] leading-none">{gen(lease.deposit_wei)}<span className="ml-2 text-[32px]">GEN</span></p>
          </div>
          <div className="rounded-card bg-limestone p-6 md:p-7">
            <p className="text-[14px] text-basalt">Held now · paid out</p>
            <p className="display figure mt-2 text-[40px] leading-none">{gen(lease.held_wei)} · {gen(paidOut)}</p>
          </div>
        </div>
      </header>

      <StageTrack lease={lease} nowMs={nowMs} />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-6">
          {live.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="display type-heading-2xl">Deductions</h2>
              {lease.released_wei !== "0" ? (
                <p className="text-[15px]">{genText(lease.released_wei)} nobody claimed went back to the tenant when claims closed.</p>
              ) : null}
              {live.map((d) => <DeductionCard key={d.id} lease={lease} d={d} />)}
              {lease.appeal ? (
                <div className="rounded-card bg-sulfur p-6 md:p-7">
                  <p className="display text-[32px] leading-none">Appeal by the {roleWord(lease.appeal.by).toLowerCase()}</p>
                  <p className="mt-2 text-[15px]">“{lease.appeal.reason}”</p>
                  <p className="mt-2 text-[14px]">
                    Bond {genText(lease.appeal.bond_wei)}.{" "}
                    {lease.appeal.result ? appealResult(lease.appeal.result) : `Evidence closes ${moment(lease.appeal.evidence_ends)}.`}
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="flex flex-col gap-4">
            <h2 className="display type-heading-2xl">The rooms</h2>
            <p className="max-w-[68ch] text-[15px] text-basalt">
              {lease.baseline_digest
                ? `The baseline was frozen ${moment(lease.baseline_frozen_at)}. Every deduction is judged against it.`
                : "The baseline is still open: what is filed now is what every later deduction will be judged against."}
            </p>
            {rooms.map((r) => <RoomCard key={r} lease={lease} roomId={r} />)}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="display type-heading-2xl">The lease</h2>
            <Card>
              <ol className="flex flex-col gap-3">
                {lease.clauses.map((k, i) => (
                  <li key={k.id} className="grid grid-cols-[40px_1fr] gap-3 text-[16px]">
                    <span className="display text-[32px] leading-none text-ember">{i + 1}</span>
                    <span>{k.text}</span>
                  </li>
                ))}
                <li className="grid grid-cols-[40px_1fr] gap-3 text-[16px]">
                  <span className="display text-[32px] leading-none text-ember">W</span>
                  <span><span className="text-basalt">Fair wear and tear: </span>{lease.wear_rule}</span>
                </li>
              </ol>
              <Dotted className="my-6" />
              <dl className="grid grid-cols-2 gap-4 text-[14px] md:grid-cols-4">
                <div><dt className="text-basalt">Check-in</dt><dd>{span(lease.windows.check_in)}</dd></div>
                <div><dt className="text-basalt">Claims</dt><dd>{span(lease.windows.claims)}</dd></div>
                <div><dt className="text-basalt">Answers</dt><dd>{span(lease.windows.response)}</dd></div>
                <div><dt className="text-basalt">Appeal</dt><dd>{span(lease.windows.appeal)}</dd></div>
              </dl>
              <p className="mt-4 text-[14px] text-basalt">The term ends {day(lease.ends_at)}.</p>
            </Card>
          </section>

          {lease.rounds.length ? (
            <section className="flex flex-col gap-4">
              <h2 className="display type-heading-2xl">The record</h2>
              {lease.rounds.map((r) => <RoundCard key={r.n} lease={lease} r={r} />)}
            </section>
          ) : null}

          <Activity lease={lease} />
          <p className="text-[13px] text-basalt">
            Read straight from the contract. <TextLink href={addressUrl(lease.landlord)} external>The landlord on the explorer</TextLink>
            {me ? ` · You are signed in as the ${roleWord(me).toLowerCase()}.` : ""}
          </p>
        </div>
        <div className="lg:sticky lg:top-28">
          <ActPanel lease={lease} nowMs={nowMs} />
        </div>
      </div>
    </div>
  );
}
