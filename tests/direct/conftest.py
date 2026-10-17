"""Direct-mode harness for LeaseResolve: the real contract module against a
stub `genlayer` that is as strict as the runtime where it matters.

  VALIDATORS RUN. `gl.vm.run_nondet` runs the leader, then the validator
  closure on the leader's result; a validator returning False fails the round
  with nothing written, like the network.

  THE MODEL. `exec_prompt` answers from per-role queues, one for photograph
  prompts ("look") and one for the judgment ("judge"), so a test can make the
  leader and a validator read the same evidence differently. It enforces
  GenVM's measured image rules: at most two images, each at most 5 MB, PNG or
  JFIF-headed JPEG only.

  THE CLOCK. `set_now(iso)` sets the transaction datetime; nothing advances
  on its own, so both sides of every window are testable.

  MONEY. `as_(module, who, wei)` sets sender and value; `_Payee.emit_transfer`
  appends to `transfers()`. A public write that raises reverts every tree,
  like the runtime, so a refusal can never leave half a state behind.
"""

import zlib
import importlib.util
import json
import os
import pathlib
import sys
import types
from datetime import datetime, timezone

import pytest
from eth_utils import to_checksum_address

CONTRACT_PATH = (pathlib.Path(__file__).resolve().parents[2]
                 / "contracts" / "leaseresolve.py")

# EIP-55 checksummed, the form the contract records signers in.
LANDLORD = to_checksum_address("0x691e25a08e00fa16fc95b159589ba563727d77a8")
TENANT = to_checksum_address("0x56e71175c0772a21a6170e3d95184f126526e9f2")
STRANGER = to_checksum_address("0xd41fca7210904c6d2f4e00c377e76f8aad43ec9e")
DEPLOYER = to_checksum_address("0x26ed19d786db6c920d0969b2d8a25f6a0fc8e338")

GEN = 10**18

_ROLE = ["leader"]
_ANSWERS = {"look": {"leader": [], "validator": []}, "judge": {"leader": [], "validator": []}}
_CALLS = {"look": {"leader": 0, "validator": 0}, "judge": {"leader": 0, "validator": 0}}
_PROMPTS = []
_FORGED = []
_ACCEPTED = []
_PRINTS = []
_TRANSFERS = []
_PAGES = {"leader": {}, "validator": {}}
_FETCHES = []
_NOW = [datetime(2026, 10, 1, 9, 0, 0, tzinfo=timezone.utc)]


class _NoAnswer(BaseException):
    """A test forgot to queue a model answer. BaseException, so the
    contract's per-image isolation cannot swallow a harness mistake."""


class _UserError(Exception):
    def __init__(self, data):
        super().__init__(data)
        self.data = data

    def __str__(self):
        return str(self.data)


class _VMError:
    def __init__(self, message):
        self.message = message


class _Return:
    def __init__(self, calldata):
        self.calldata = calldata


def _roundtrip(value):
    """Consensus serializes the leader's result; round-tripping enforces
    that everything returned is plain data."""
    return json.loads(json.dumps(value))


def _run_nondet(leader_fn, validator_fn):
    if _ACCEPTED:
        # A result the network accepted whatever it says: tests the contract's
        # own boundary checks, the layer behind the validators.
        return _ACCEPTED.pop(0)
    if _FORGED:
        forged = _FORGED.pop(0)
        _ROLE[0] = "validator"
        try:
            ok = validator_fn(_Return(forged))
        except Exception:
            ok = False
        finally:
            _ROLE[0] = "leader"
        if not ok:
            raise _UserError("[LLM_ERROR] validators did not agree with the leader")
        return forged
    try:
        value = _roundtrip(leader_fn())
    except _UserError as e:
        _ROLE[0] = "validator"
        try:
            agreed = validator_fn(e)
        except Exception:
            agreed = False
        finally:
            _ROLE[0] = "leader"
        raise _UserError(e.data if agreed else
                         "[LLM_ERROR] validators disagreed with the leader's failure")
    _ROLE[0] = "validator"
    try:
        ok = validator_fn(_Return(value))
    except Exception:
        ok = False
    finally:
        _ROLE[0] = "leader"
    if not ok:
        raise _UserError("[LLM_ERROR] validators did not agree with the leader")
    return value


class _TreeMap(dict):
    def __class_getitem__(cls, item):
        return cls

    def get(self, k, default=None):
        return super().get(k, default)


class _U256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


class _Address:
    def __init__(self, v):
        text = str(v).strip()
        if not (text.startswith("0x") and len(text) == 42):
            raise ValueError("not an address")
        int(text[2:], 16)
        self.as_hex = to_checksum_address(text)

    def __str__(self):
        return self.as_hex


class _ViewDeco:
    def __call__(self, fn):
        return fn


class _WriteDeco:
    payable = staticmethod(lambda fn: fn)

    def __call__(self, fn):
        return fn


class _Public:
    view = _ViewDeco()
    write = _WriteDeco()


def _sniff_ok(img: bytes) -> bool:
    return img[:8] == b"\x89PNG\r\n\x1a\n" or img[:4] == b"\xff\xd8\xff\xe0"


def _exec_prompt(prompt, response_format=None, images=None):
    role = _ROLE[0]
    kind = "look" if images else "judge"
    if images is not None:
        if len(images) > 2:
            raise RuntimeError("TOO_MANY_IMAGES")
        for img in images:
            if len(img) > 5 * 1024 * 1024:
                raise RuntimeError("IMAGE_TOO_LARGE")
            if not _sniff_ok(bytes(img)):
                raise RuntimeError("INVALID_IMAGE")
    _PROMPTS.append({"role": role, "kind": kind, "prompt": prompt,
                     "images": len(images or [])})
    queue = _ANSWERS[kind][role] or _ANSWERS[kind]["leader"]
    if not queue:
        raise _NoAnswer(f"test ran a {kind} prompt without an answer for it")
    idx = min(_CALLS[kind][role], len(queue) - 1)
    _CALLS[kind][role] += 1
    answer = queue[idx]
    if callable(answer):
        answer = answer(prompt, images)
    if isinstance(answer, BaseException):
        raise answer
    return answer


class _Fetched:
    def __init__(self, status, body):
        self.status = status
        self.body = body


def _web_get(url):
    role = _ROLE[0]
    _FETCHES.append({"role": role, "url": url})
    served = _PAGES[role].get(url, _PAGES["leader"].get(url))
    if served is None:
        return _Fetched(404, b"")
    if isinstance(served, BaseException):
        raise served
    return _Fetched(*served)


class _PayeeProxy:
    def __init__(self, addr):
        self.addr = str(addr)

    def emit_transfer(self, value=0):
        _TRANSFERS.append({"to": self.addr, "wei": int(value)})


def _contract_interface(cls):
    return _PayeeProxy


def _print_hook(*args, **kwargs):
    _PRINTS.append(" ".join(str(a) for a in args))


def _install():
    gl = types.ModuleType("genlayer")
    gl.public = _Public()
    gl.contract = types.SimpleNamespace(Contract=type("Contract", (), {}))
    gl.storage = types.SimpleNamespace(TreeMap=_TreeMap)
    gl.vm = types.SimpleNamespace(UserError=_UserError, VMError=_VMError,
                                  Return=_Return, run_nondet=_run_nondet)
    gl.nondet = types.SimpleNamespace(exec_prompt=_exec_prompt,
                                      web=types.SimpleNamespace(get=_web_get))
    gl.message = types.SimpleNamespace(sender_address=DEPLOYER, value=0)
    gl.evm = types.SimpleNamespace(contract_interface=_contract_interface)
    gl_types = types.ModuleType("genlayer.types")
    gl_types.u256 = _U256
    gl_types.Address = _Address
    gl.types = gl_types
    sys.modules["genlayer"] = gl
    sys.modules["genlayer.types"] = gl_types
    return gl


class _FakeDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return _NOW[0]


def _load():
    _install()
    spec = importlib.util.spec_from_file_location("leaseresolve_contract", CONTRACT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.print = _print_hook
    mod.datetime = _FakeDateTime
    return mod


@pytest.fixture
def module():
    # The stub SDK must not outlive its test: the official-runner suite loads
    # the real `genlayer` in the same session.
    saved = {k: v for k, v in sys.modules.items()
             if k == "genlayer" or k.startswith("genlayer.")}
    try:
        yield _load()
    finally:
        for k in [k for k in sys.modules if k == "genlayer" or k.startswith("genlayer.")]:
            del sys.modules[k]
        sys.modules.update(saved)


if sys.platform == "win32":
    # genlayer-test's direct loader unlinks a temp file it still holds open,
    # which POSIX allows and Windows refuses; tolerate exactly that locally.
    _real_unlink = os.unlink

    def _tolerant_unlink(path, *args, **kwargs):
        try:
            _real_unlink(path, *args, **kwargs)
        except PermissionError:
            pass

    os.unlink = _tolerant_unlink


_TREES = ("counters", "leases", "role_index", "items", "item_bytes", "item_text",
          "rounds", "ledger", "events")

_PUBLIC_WRITES = ("create_lease", "cancel_lease", "accept_lease", "file_photo", "file_note",
                  "confirm_baseline", "end_tenancy", "file_deduction", "withdraw_deduction",
                  "close_claims", "answer_deduction", "concede_deduction", "close_responses",
                  "request_ruling", "settle_unresolved", "finalize", "open_appeal",
                  "decide_appeal", "lapse_appeal", "claim")


def _revert_on_raise(inst, name):
    fn = getattr(inst, name)

    def wrapped(*args, **kwargs):
        snapshot = {t: dict(getattr(inst, t)) for t in _TREES}
        n_transfers = len(_TRANSFERS)
        try:
            return fn(*args, **kwargs)
        except BaseException:
            for t, data in snapshot.items():
                tree = getattr(inst, t)
                tree.clear()
                tree.update(data)
            del _TRANSFERS[n_transfers:]
            raise

    return wrapped


def _fresh_instance(mod):
    inst = mod.LeaseResolve.__new__(mod.LeaseResolve)
    for name in _TREES:
        setattr(inst, name, _TreeMap())
    mod.gl.message.sender_address = DEPLOYER
    mod.gl.message.value = 0
    inst.__init__()
    for name in _PUBLIC_WRITES:
        setattr(inst, name, _revert_on_raise(inst, name))
    return inst


def _reset():
    _ROLE[0] = "leader"
    for kind in _ANSWERS:
        for role in _ANSWERS[kind]:
            _ANSWERS[kind][role].clear()
            _CALLS[kind][role] = 0
    _PROMPTS.clear()
    _FORGED.clear()
    _ACCEPTED.clear()
    _PRINTS.clear()
    _TRANSFERS.clear()
    _PAGES["leader"].clear()
    _PAGES["validator"].clear()
    _FETCHES.clear()
    _NOW[0] = datetime(2026, 10, 1, 9, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def c(module):
    _reset()
    return _fresh_instance(module)


# ── helpers ──────────────────────────────────────────────────────────────────

def as_(module, who, value=0):
    module.gl.message.sender_address = who
    module.gl.message.value = value


def err(module):
    return module.gl.vm.UserError


def set_now(iso):
    _NOW[0] = datetime.fromisoformat(iso.replace("Z", "+00:00"))


def reset_prompts():
    _PROMPTS.clear()


def prompts(kind=None, role=None):
    return [p for p in _PROMPTS if (kind is None or p["kind"] == kind)
            and (role is None or p["role"] == role)]


def prints():
    return list(_PRINTS)


def transfers():
    return list(_TRANSFERS)


def web_page(url, body, status=200, validator=None):
    """Serve a page to every node; `validator` serves that role another body."""
    _PAGES["leader"][url] = body if isinstance(body, BaseException) else (status, body)
    if validator is not None:
        _PAGES["validator"][url] = (status, validator)


def fetches(role=None):
    return [f["url"] for f in _FETCHES if role is None or f["role"] == role]


def forge_leader(value):
    _FORGED.append(value)


def network_accepts(value):
    """The next round's consensus result, as if the network had accepted it."""
    _ACCEPTED.append(value)


def seg(marker: int, body: bytes = b"") -> bytes:
    """One JPEG segment: its marker, its length, its body."""
    return bytes([0xff, marker]) + (len(body) + 2).to_bytes(2, "big") + body


# The pieces of the smallest JPEG a decoder opens, by name, in file order.
JPEG_PARTS = {
    "soi": b"\xff\xd8",
    "app0": seg(0xe0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"),
    "note": b"",
    "dqt": seg(0xdb, b"\x00" + b"\x01" * 64),
    "sof": seg(0xc0, b"\x08\x00\x08\x00\x08\x01\x01\x11\x00"),
    "dc": seg(0xc4, b"\x00\x01" + b"\x00" * 15 + b"\x00"),
    "ac": seg(0xc4, b"\x10\x01" + b"\x00" * 15 + b"\x00"),
    "sos": seg(0xda, b"\x01\x01\x00\x00\x3f\x00"),
    "scan": b"\x00" * 8,
    "end": b"\xff\xd9",
}


def jpeg(size=0, **over) -> bytes:
    """A whole JPEG from its named pieces, any of them replaced or emptied,
    its scan padded with zeros to the size asked for."""
    parts = dict(JPEG_PARTS, **over)
    short = size - sum(len(v) for v in parts.values())
    parts["scan"] += b"\x00" * max(0, short)
    return b"".join(parts.values())


def jfif(tag=b"", size=4000):
    """A JPEG a decoder opens, made distinct by a comment, at an exact size."""
    return jpeg(size=size, note=seg(0xfe, tag) if tag else b"")


def chunk(name: bytes, body: bytes = b"") -> bytes:
    """One PNG chunk with its true checksum."""
    return len(body).to_bytes(4, "big") + name + body \
        + (zlib.crc32(name + body) & 0xffffffff).to_bytes(4, "big")


def ihdr(width=2, height=2, bits=8, kind=0, interlace=0, compression=0, filtering=0) -> bytes:
    return chunk(b"IHDR", width.to_bytes(4, "big") + height.to_bytes(4, "big")
                 + bytes([bits, kind, compression, filtering, interlace]))


# The pieces of the smallest PNG a decoder opens: two rows of two grey pixels.
PNG_PARTS = {
    "sig": b"\x89PNG\r\n\x1a\n",
    "ihdr": ihdr(),
    "plte": b"",
    "note": b"",
    "idat": chunk(b"IDAT", zlib.compress(b"\x00\x00\x00" * 2)),
    "pad": b"",
    "iend": chunk(b"IEND"),
}


def png_file(size=0, **over) -> bytes:
    parts = dict(PNG_PARTS, **over)
    short = size - sum(len(v) for v in parts.values()) - 12
    if short >= 0:
        parts["pad"] = chunk(b"zzPd", b"\x00" * short)
    return b"".join(parts.values())


def png(tag=b"", size=2000):
    return png_file(size=size, note=chunk(b"tEXt", b"Comment\x00" + tag) if tag else b"")


def exif_jpeg(size=4000):
    body = b"\xff\xd8\xff\xe1\x00\x10Exif\x00"
    return body + b"\x00" * max(0, size - len(body))






# ── the domain: a lease, its evidence, and the model answers a round reads ──

ENDS = "2027-09-30T12:00:00Z"
WINDOWS = {"check_in": 3600, "claims": 3600, "response": 3600, "appeal": 3600}
DEPOSIT = 5 * GEN
ROOMS = [{"name": "Living room"}, {"name": "Bathroom"}, {"name": "Kitchen"}]
CLAUSES = ["The tenant returns the flat in the condition recorded at move-in, "
           "fair wear and tear excepted.",
           "The landlord repairs plumbing faults the tenant reports."]
WEAR = "Light scuffs, faded paint and worn carpet from normal living are fair wear and tear."


def lease_params(**over):
    p = {"title": "Two-bedroom flat, Lekki Phase 1", "property": "Flat 4B, 12 Admiralty Way",
         "tenant": TENANT, "deposit_wei": str(DEPOSIT), "ends_at": ENDS, "rooms": ROOMS,
         "clauses": CLAUSES, "wear_rule": WEAR, "windows": dict(WINDOWS)}
    p.update(over)
    return json.dumps(p)


def offered(module, c, **over):
    as_(module, LANDLORD)
    return json.loads(c.create_lease(lease_params(**over)))["lease_id"]


def photo(module, c, lid, who, room="R1", caption="the wall", data=None, did=""):
    as_(module, who)
    meta = {"room_id": room, "caption": caption, "deduction_id": did}
    return json.loads(c.file_photo(lid, json.dumps(meta),
                                   data if data is not None else jfif(f"{who}{room}{caption}{did}".encode())))["item_id"]


def note(module, c, lid, who, room="R1", text="The walls are freshly painted.", did=""):
    as_(module, who)
    return json.loads(c.file_note(lid, json.dumps({"room_id": room, "deduction_id": did}),
                                  text))["item_id"]


def accept(module, c, lid, wei=DEPOSIT, who=None):
    as_(module, who or TENANT, wei)
    out = json.loads(c.accept_lease(lid))
    as_(module, who or TENANT, 0)
    return out


def in_tenancy(module, c, baseline=True, tenant_photo=False):
    """A lease whose baseline holds a landlord photograph of R1 and R2."""
    lid = offered(module, c)
    ids = {}
    if baseline:
        ids["bl_r1"] = photo(module, c, lid, LANDLORD, "R1", "living room walls")
        ids["bl_r2"] = photo(module, c, lid, LANDLORD, "R2", "bathroom sink")
        ids["bl_note_r1"] = note(module, c, lid, LANDLORD, "R1")
    assert accept(module, c, lid)["refused"] is False
    if tenant_photo:
        ids["blt_r1"] = photo(module, c, lid, TENANT, "R1", "a scuff by the door")
    as_(module, TENANT)
    c.confirm_baseline(lid)
    return lid, ids


def moved_out(module, c, **kw):
    lid, ids = in_tenancy(module, c, **kw)
    as_(module, TENANT)
    c.end_tenancy(lid)
    return lid, ids


def deduct(module, c, lid, room="R1", amount=GEN, text="Holes and a large stain on the wall",
           data=None):
    as_(module, LANDLORD)
    return json.loads(c.file_deduction(lid, room, text, str(amount),
                                       data if data is not None else jfif(f"out{room}{amount}{text}".encode())))


def disputed(module, c, n=1, tenant_answer_photo=False, **kw):
    """A lease with n deductions (R1, R2, R1...) all disputed, awaiting a ruling."""
    lid, ids = moved_out(module, c, **kw)
    rooms = ["R1", "R2", "R1"]
    dids = []
    for i in range(n):
        out = deduct(module, c, lid, rooms[i], GEN, f"Damage number {i + 1}")
        dids.append(out["deduction_id"])
        ids[f"out_{out['deduction_id']}"] = out["photo"]
    as_(module, LANDLORD)
    c.close_claims(lid)
    for did in dids:
        as_(module, TENANT)
        c.answer_deduction(lid, did, False, "It was like that when I moved in.",
                           jfif(f"ans{did}".encode()) if tenant_answer_photo else b"")
    as_(module, TENANT)
    c.close_responses(lid)
    return lid, ids, dids


def look_ok(n=2, marks=None):
    return {"images": [{"n": i + 1, "readable": True, "shows": "A painted wall in a room.",
                        "marks": marks or []} for i in range(n)], "compare": "Image 2 has holes."}


def judgment(findings, basis=None):
    """findings: {D1: TENANT_DAMAGE, ...}; basis: {D1: [ids]}."""
    return {"reasoning": "Compared move-in and move-out.",
            "deductions": [{"id": k, "finding": v, "basis": (basis or {}).get(k, []),
                            "note": "One sentence."} for k, v in findings.items()]}


def rule(module, c, lid, judge, look=None, v_judge=None, v_look=None, who=None):
    llm(look=look if look is not None else look_ok(), judge=judge, v_judge=v_judge, v_look=v_look)
    as_(module, who or TENANT)
    return json.loads(c.request_ruling(lid))


def llm(look=None, judge=None, v_look=None, v_judge=None):
    """Queue model answers; validator queues default to the leader's."""
    for kind, leader, validator in (("look", look, v_look), ("judge", judge, v_judge)):
        _ANSWERS[kind]["leader"].clear()
        _ANSWERS[kind]["validator"].clear()
        _CALLS[kind]["leader"] = 0
        _CALLS[kind]["validator"] = 0
        if leader is not None:
            _ANSWERS[kind]["leader"].extend(leader if isinstance(leader, list) else [leader])
        if validator is not None:
            _ANSWERS[kind]["validator"].extend(validator if isinstance(validator, list) else [validator])


def claimable(c, addr):
    return int(json.loads(c.get_balance(addr))["claimable"])


def lease(c, lid):
    return json.loads(c.get_lease(lid))


def conserved(c, lid):
    """Every wei a lease ever took in is held or paid, never both, never lost."""
    l = lease(c, lid)
    took = int(l["deposit_wei"]) if l["accepted_at"] else 0
    if l.get("appeal"):
        took += int(l["appeal"]["bond_wei"])
    return int(l["held_wei"]) + int(l["paid_landlord_wei"]) + int(l["paid_tenant_wei"]) == took
