# Security review

Five adversarial review rounds ran on the contract before the deployment of record, each by a reviewer who had not written it, each given the previous round's diff and told to attack it first. Every finding came with a test that failed on the code it was written against; those tests now live in `tests/direct/test_audit.py`.

## Round 1

- **HIGH** Photographs were paired into prompts by position, so one party's file that the runtime refuses could set aside the other party's photograph in the same prompt and defeat a deduction it had nothing to do with.
- **MEDIUM** A room's move-in and move-out photographs did not always share a prompt.
- **LOW** A leader-only list of unread photographs was written into the record; the round record listed items no node was shown.

Changed: photographs grouped by room and filer; validators check the leader's cited basis against their own reading; the record lists only what was shown.

## Round 2

- **HIGH** An appellant lost the bond when the other side conceded the appealed point during the appeal.
- **MEDIUM** (x2) A party's own bad file could still remove a shared baseline reading; the first reading of a photograph was kept even when a later one succeeded.
- **LOW** The move-out photograph never travelled beside the tenant's baseline photograph.

Changed: a photograph a pair fails to read is read again alone; a photograph counts as read if any reading of it was; the appeal records what it contests when filed.

## Round 3

- **HIGH** (x2) Both inside round 2's "moot appeal" rule: an appellant could abandon an appeal for free by conceding their own point, and a partial concession still forfeited the bond.
- **MEDIUM** A party could garble every reading of their own photograph to force the long stop.

Changed, by removing mechanisms rather than patching them: no concessions while an appeal is pending (the moot path is gone); an unreadable photograph only costs its filer; a node is blind only if it read none of the photographs.

## Round 4

- **HIGH** With the long stop then paying the tenant, a tenant photograph that only some nodes can read could keep validators split and win the deduction whole.
- **MEDIUM** Honest validators that agreed on the money but not the exact tenant-side label blocked the ruling.

Changed: validators bind who is paid, not the label (tenant damage must still stand on what each validator saw); the long stop splits evenly.

## Round 5

Clean: nothing above LOW. One observation is kept as a note: once the long stop has passed, a ruling request and a settlement can race; both are open to both sides, and either outcome is legitimate.

## Mutation sweeps

`tests/mutation/mutate.py` breaks 75 rules of the contract one at a time; the suite must fail for every one. Three further mutants are left out on purpose as equivalent (the file says which and why). `web/tests/mutation/mutate.mjs` does the same for 27 rules of the interface.

## Limits that remain

- A deduction is paid whole or not at all; the amount is the landlord's to name.
- `REPORTED_UNREPAIRED` rests on the tenant's own dated notice; the validators judge whether it describes the condition.
- Among the four findings that return a deduction to the tenant, the stored label is the leading validator's reading.
- A photograph some validators can read and others cannot can stall a round; the long stop then splits evenly, so the side that causes it gains at most half.
- A deduction left unanswered when the response period ends counts as accepted.
- Party text reaches the prompt fenced and defused, and every party label (which room a photograph shows) is presented as the filer's claim.
- Rendered photographs are used in the live proofs; real photographs work the same way (the app redraws them as JFIF JPEG under 400 KB).
