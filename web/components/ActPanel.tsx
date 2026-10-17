"use client";

/**
 * "Your move": every act the connected wallet can take on this lease, and
 * the ones it is waiting on, with the contract's own reason when an act is
 * not open yet. Choosing an act opens its form; signing goes through the
 * Transaction Kit bound to the connected wallet.
 */
import { useMemo, useState } from "react";

import { Button, Tag } from "./bits";
import { TxPanel, type TxOutcome } from "./TxPanel";
import { actsFor, baselineRooms, claimRoom, roleOf, waitingOn, type Act, type ActId } from "@/lib/acts";
import { callFor, PAYABLE, ROUNDS, type Inputs } from "@/lib/calls";
import { CONTRACT_ADDRESS } from "@/lib/config";
import { preparePhoto, type PreparedPhoto } from "@/lib/images";
import { useTransactionKit } from "@/lib/kit";
import { deductionName, gen, genText, refusal, role as roleWord, roomName, toWei } from "@/lib/present";
import { returnedJson } from "@/lib/receipt";
import type { Lease } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

/** What each act does, said once, in the panel. */
const SAYS: Partial<Record<ActId, string>> = {
  accept_lease: "Pays the deposit into the contract. Check the rooms first: the baseline you accept is what every deduction is judged against.",
  cancel_lease: "Nothing has been paid, so nothing moves.",
  baseline_photo: "The contract stores and hashes the photograph itself. One per room from each side.",
  baseline_note: "Your description of the room on move-in day, part of the frozen baseline.",
  confirm_baseline: "Freezes the baseline and records its digest. Nothing can be added after.",
  notice: "Dated by the contract's own clock. A ruling can rely on it as proof a problem was reported.",
  end_tenancy: "Starts the landlord's claims period.",
  file_deduction: "Needs a photograph taken at move-out. The amount is paid whole or not at all.",
  close_claims: "Whatever the claims do not ask for goes to the tenant now.",
  answer_deduction: "Accepting pays it to the landlord now. Disputing sends it to a ruling.",
  close_responses: "Any deduction left unanswered counts as accepted.",
  request_ruling: "Every validator reads the photographs blind, then judges each disputed deduction. It takes a few minutes.",
  settle_unresolved: "No ruling was obtained by the long stop, so each disputed deduction is split evenly.",
  finalize: "Pays each disputed deduction as the ruling says.",
  open_appeal: "Opens an evidence period for both sides, then a fresh ruling on everything. Nothing can be given up while it runs. The bond comes back if the appeal moves anything you contest.",
  appeal_photo: "New evidence for the appeal, marked as new in the appeal's record.",
  appeal_note: "Argument or context for the appeal.",
  decide_appeal: "The validators judge every disputed deduction again, on old and new evidence. It takes a few minutes.",
  lapse_appeal: "The first ruling stands and the bond goes back.",
};

function PhotoPicker({ value, onChange }: { value: PreparedPhoto | null; onChange: (p: PreparedPhoto | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        accept="image/*"
        className="field"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setError("");
          if (!f) return onChange(null);
          setBusy(true);
          try {
            onChange(await preparePhoto(f));
          } catch (err) {
            setError(String((err as Error)?.message ?? err));
            onChange(null);
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy ? <p className="type-caption">Preparing the photograph.</p> : null}
      {error ? <p className="type-caption">{error}</p> : null}
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value.preview} alt="The photograph to be filed" className="h-40 w-full rounded-[20px] object-cover" />
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[14px] text-chalk/80">{label}</span>
      {children}
    </label>
  );
}

function ActForm({ lease, act, onCancel }: { lease: Lease; act: Act; onCancel: () => void }) {
  const wallet = useWallet();
  const kit = useTransactionKit();
  const me = roleOf(lease, wallet.address);
  const [roomId, setRoomId] = useState("");
  const [deductionId, setDeductionId] = useState(act.deduction ?? "");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [amount, setAmount] = useState("");
  const [accept, setAccept] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [signing, setSigning] = useState(false);
  const [after, setAfter] = useState<string>("");

  const rooms = act.id === "baseline_photo" ? baselineRooms(lease, me || "LANDLORD", "PHOTO")
    : act.id === "baseline_note" ? baselineRooms(lease, me || "LANDLORD", "NOTE")
    : lease.rooms.map((r) => r.id);
  const disputed = lease.deductions.filter((d) => d.state === "DISPUTED");
  const amountWei = toWei(amount);
  const value = act.id === "accept_lease" ? BigInt(lease.deposit_wei)
    : act.id === "open_appeal" ? BigInt(lease.appeal_bond_wei) : undefined;

  const inputs: Inputs = {
    roomId, deductionId, caption, text, photo: photo?.bytes, amountWei: amountWei ?? 0n,
    accept: accept === true, valueWei: value,
  };

  const missing = ((): string => {
    switch (act.id) {
      case "baseline_photo": return !roomId ? "Choose a room." : !photo ? "Choose a photograph." : "";
      case "baseline_note":
      case "notice": return !roomId ? "Choose a room." : text.trim().length < 3 ? "Write the note." : "";
      case "file_deduction":
        if (!roomId) return "Choose a room.";
        if (text.trim().length < 3) return "Say what the deduction is for.";
        if (!amountWei || amountWei <= 0n) return "Enter an amount in GEN.";
        if (amountWei > claimRoom(lease)) return `That is more than the ${genText(claimRoom(lease))} the deposit has left to claim.`;
        return !photo ? "A deduction needs a move-out photograph." : "";
      case "answer_deduction":
        if (accept === null) return "Accept it or dispute it.";
        return accept === false && text.trim().length < 3 ? "Say why you dispute it." : "";
      case "open_appeal": return text.trim().length < 3 ? "Give your reason." : "";
      case "appeal_photo": return !deductionId ? "Choose the deduction." : !photo ? "Choose a photograph." : "";
      case "appeal_note": return !deductionId ? "Choose the deduction." : text.trim().length < 3 ? "Write the note." : "";
      default: return "";
    }
  })();

  // The transaction is frozen when signing starts (the panel keeps its own copy).
  const tx = useMemo(() => {
    const call = callFor(act.id, lease.lease_id, inputs);
    return { kind: "write" as const, address: CONTRACT_ADDRESS, method: call.method, args: call.args };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signing]);

  async function done(outcome: TxOutcome) {
    if (!outcome.successful || !outcome.hash) return;
    if (PAYABLE.has(act.id)) {
      // A payable write answers a refusal by returning, so success on chain
      // is not success here until the returned record says so.
      const out = await returnedJson<{ refused?: boolean; reason?: string }>(outcome.hash).catch(() => null);
      if (out?.refused) {
        setAfter(`The contract refused it: ${refusal(out.reason ?? "")} What you sent is credited back to this wallet.`);
        return;
      }
    }
    setAfter("Done. The lease below now shows it.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="display text-[32px] leading-none">{act.title}</p>
        {SAYS[act.id] ? <p className="mt-2 text-[14px] text-chalk/75">{SAYS[act.id]}</p> : null}
      </div>

      {!signing ? (
        <>
          {["baseline_photo", "baseline_note", "notice", "file_deduction"].includes(act.id) ? (
            <Field label="Room">
              <select className="field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Choose a room</option>
                {rooms.map((r) => <option key={r} value={r}>{roomName(lease, r)}</option>)}
              </select>
            </Field>
          ) : null}

          {["appeal_photo", "appeal_note"].includes(act.id) ? (
            <Field label="For which deduction">
              <select className="field" value={deductionId} onChange={(e) => setDeductionId(e.target.value)}>
                <option value="">Choose a deduction</option>
                {disputed.map((d) => (
                  <option key={d.id} value={d.id}>{deductionName(d)}, {roomName(lease, d.room_id)}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {act.id === "answer_deduction" ? (
            <div className="flex flex-wrap gap-2">
              <Button variant={accept === true ? "primary" : "chalk"} onClick={() => setAccept(true)}>Accept it</Button>
              <Button variant={accept === false ? "primary" : "chalk"} onClick={() => setAccept(false)}>Dispute it</Button>
            </div>
          ) : null}

          {act.id === "file_deduction" ? (
            <Field label="Amount, in GEN">
              <input className="field figure" inputMode="decimal" placeholder="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          ) : null}

          {["baseline_note", "notice", "file_deduction", "open_appeal", "appeal_note"].includes(act.id)
            || (act.id === "answer_deduction" && accept === false) ? (
              <Field label={
                act.id === "file_deduction" ? "What is wrong, and where"
                  : act.id === "open_appeal" ? "Why the ruling is wrong"
                  : act.id === "answer_deduction" ? "Why you dispute it"
                  : act.id === "notice" ? "What needs repairing"
                  : act.id === "baseline_note" ? "The room's condition today"
                  : "Your note"
              }>
                <textarea className="field" maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
            ) : null}

          {["baseline_photo", "appeal_photo"].includes(act.id) ? (
            <Field label="What it shows (optional)">
              <input className="field" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </Field>
          ) : null}

          {["baseline_photo", "appeal_photo", "file_deduction"].includes(act.id)
            || (act.id === "answer_deduction" && accept === false) ? (
              <Field label={act.id === "answer_deduction" ? "Your photograph (optional)" : act.id === "file_deduction" ? "Move-out photograph" : "Photograph"}>
                <PhotoPicker value={photo} onChange={setPhoto} />
              </Field>
            ) : null}

          {value !== undefined ? (
            <p className="rounded-pill bg-chalk/10 px-4 py-2 text-[14px]">
              Sends {genText(value)} {act.id === "open_appeal" ? "as the appeal bond" : "as the deposit"}.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!!missing || !kit || !wallet.chainOk} onClick={() => setSigning(true)}>Review and sign</Button>
            <Button variant="chalk" onClick={onCancel}>Back</Button>
          </div>
          {missing ? <p className="type-caption">{missing}</p> : null}
          {!kit && wallet.address && !wallet.chainOk ? <p className="type-caption">Switch the wallet to Studio Next first.</p> : null}
        </>
      ) : kit ? (
        <>
          <TxPanel
            kit={kit}
            tx={tx}
            value={value}
            confirmText="Sign"
            working={ROUNDS.has(act.id) ? "Each validator is reading the photographs and judging the deductions. This takes a few minutes." : undefined}
            onDone={(o) => void done(o)}
            onClose={() => { setSigning(false); onCancel(); }}
          />
          {after ? <p className="rounded-[20px] bg-chalk/10 p-4 text-[14px]">{after}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function ActPanel({ lease, nowMs }: { lease: Lease; nowMs: number }) {
  const wallet = useWallet();
  const [open, setOpen] = useState<Act | null>(null);
  const me = roleOf(lease, wallet.address);
  const acts = actsFor(lease, wallet.address, nowMs);

  return (
    <section className="on-dark rounded-card bg-obsidian p-7 text-chalk md:p-8" aria-label="Your move">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="display text-[40px] leading-none">Your move</p>
        {me ? <Tag tone="ember">You are the {roleWord(me).toLowerCase()}</Tag> : wallet.address ? <Tag tone="plain">Not a party</Tag> : null}
      </div>
      <p className="mt-3 text-[14px] text-chalk/75">{waitingOn(lease, nowMs)}</p>

      {!wallet.address ? (
        <p className="mt-6 text-[14px]">Connect a wallet to act on this lease. Anyone can read it.</p>
      ) : open ? (
        <div className="mt-6"><ActForm key={`${open.id}.${open.deduction ?? ""}`} lease={lease} act={open} onCancel={() => setOpen(null)} /></div>
      ) : acts.length === 0 ? (
        <p className="mt-6 text-[14px]">
          {lease.state === "SETTLED" || lease.state === "CANCELLED"
            ? "There is nothing left to do on this lease."
            : "Nothing is yours to do at this stage."}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {acts.map((a) => (
            <li key={`${a.id}.${a.deduction ?? ""}`}>
              <button
                type="button"
                disabled={!a.ready}
                onClick={() => setOpen(a)}
                className={`w-full rounded-[24px] px-5 py-4 text-left transition-colors ${a.ready ? "bg-chalk/10 hover:bg-ember hover:text-obsidian" : "cursor-default bg-transparent outline outline-1 outline-chalk/25"}`}
              >
                <span className="block text-[16px]">{a.title}</span>
                {!a.ready ? <span className="mt-1 block text-[13px] text-chalk/65">{a.why}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {lease.state === "RULED" ? (
        <p className="mt-5 text-[13px] text-chalk/65">An appeal bond is {gen(lease.appeal_bond_wei)} GEN.</p>
      ) : null}
    </section>
  );
}
