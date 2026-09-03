#!/usr/bin/env python3
"""Unsigned TestNet pulse sample. No execute. Skip 81. Never poke 87."""
import base64, hashlib, json, sqlite3, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ALGOD = "https://testnet-api.algonode.cloud"
KEEPER = 769891898
SKIP = {81, 87}  # 81 Vigil; never poke 87
HEAD = 130
ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
UA = {"User-Agent": "arcron-pulse", "Accept": "application/json"}


def get(path):
    req = urllib.request.Request(ALGOD + path, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def sha512_256(b):
    return hashlib.new("sha512_256", b).digest()


def encode_address(pubkey32):
    crc = sha512_256(pubkey32)[-4:]
    return base64.b32encode(pubkey32 + crc).decode().rstrip("=")


def app_address(app_id):
    return encode_address(sha512_256(b"appID" + int(app_id).to_bytes(8, "big")))


def u64(raw, off):
    return int.from_bytes(raw[off : off + 8], "big")


def u16(raw, off):
    return int.from_bytes(raw[off : off + 2], "big")


def list_boxes():
    names = []
    next_token = ""
    while True:
        q = f"?next={urllib.parse.quote(next_token)}" if next_token else ""
        page = get(f"/v2/applications/{KEEPER}/boxes{q}")
        for box in page.get("boxes") or []:
            names.append(box["name"])
        next_token = page.get("next-token") or ""
        if not next_token:
            return names


def decode_upkeep(upkeep_id, raw):
    if len(raw) < HEAD + 2:
        raise ValueError("box %s too short (%s)" % (upkeep_id, len(raw)))
    tail = u16(raw, 40)
    if tail != HEAD:
        raise ValueError("box %s tail %s != %s" % (upkeep_id, tail, HEAD))
    return {
        "id": upkeep_id,
        "interval": u64(raw, 42),
        "next": u64(raw, 50),
        "fee": u64(raw, 58),
        "balance": u64(raw, 66),
    }


def main():
    st = get("/v2/status")
    last_round = int(st.get("last-round"))
    params = get("/v2/transactions/params")
    genesis = params.get("genesis-id") or st.get("genesis-id")
    app = get("/v2/applications/%s" % KEEPER)
    gs = (app.get("params") or {}).get("global-state") or []
    gs_keys = [x.get("key") for x in gs if x.get("key")]
    acct = get("/v2/accounts/%s" % app_address(KEEPER))
    escrow_micro = int(acct.get("amount") or 0)

    listed = 0
    due = 0
    unfunded = 0
    on_schedule = 0
    skipped = 0
    for name_b64 in list_boxes():
        name = base64.b64decode(name_b64)
        if len(name) < 9 or name[0] != 0x75:
            continue
        uid = u64(name, 1)
        listed += 1
        if uid in SKIP:
            skipped += 1
            continue
        box = get("/v2/applications/%s/box?name=b64:%s" % (KEEPER, urllib.parse.quote(name_b64)))
        raw = base64.b64decode(box["value"])
        u = decode_upkeep(uid, raw)
        late = last_round - u["next"] if last_round > u["next"] else 0
        overdue = late > u["interval"] if u["interval"] else last_round >= u["next"]
        if not overdue:
            on_schedule += 1
            continue
        due += 1
        if u["balance"] < u["fee"]:
            unfunded += 1

    sample = {
        "t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "round": last_round,
        "listed": listed,
        "due": due,
        "skipped": skipped,
        "unfunded": unfunded,
        "waiting": None,
        "on_schedule": on_schedule,
        "escrow_micro": escrow_micro,
        "source": "probe.py unsigned algod",
        "keeper": KEEPER,
        "genesis": genesis,
        "skip": [81],
    }
    hist_path = DOCS / "history.json"
    hist = []
    if hist_path.exists():
        hist = json.loads(hist_path.read_text())
        if not isinstance(hist, list):
            hist = []
    if not any(h.get("round") == last_round and h.get("source") == sample["source"] for h in hist):
        hist.append(sample)
    hist.sort(key=lambda h: (h.get("round") or 0, h.get("t") or ""))
    DOCS.mkdir(parents=True, exist_ok=True)
    hist_path.write_text(json.dumps(hist, indent=2) + "\n")
    live = {
        "round": last_round,
        "keeper": KEEPER,
        "genesis": genesis,
        "t": sample["t"],
        "global_state_keys": gs_keys[:12],
        "skip": [81],
        "listed": listed,
        "due": due,
        "skipped": skipped,
        "unfunded": unfunded,
        "on_schedule": on_schedule,
        "escrow_micro": escrow_micro,
    }
    (DOCS / "live.json").write_text(json.dumps(live, indent=2) + "\n")
    try:
        dbp = DOCS / "pulse.sqlite"
        con = sqlite3.connect(dbp)
        con.execute(
            "CREATE TABLE IF NOT EXISTS samples (t TEXT, round INTEGER, listed INTEGER, due INTEGER, skipped INTEGER, unfunded INTEGER, waiting INTEGER, on_schedule INTEGER, escrow_micro INTEGER, source TEXT)"
        )
        con.execute("DELETE FROM samples")
        con.executemany(
            "INSERT INTO samples VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    h.get("t"),
                    h.get("round"),
                    h.get("listed"),
                    h.get("due"),
                    h.get("skipped"),
                    h.get("unfunded"),
                    h.get("waiting"),
                    h.get("on_schedule"),
                    h.get("escrow_micro"),
                    h.get("source"),
                )
                for h in hist
            ],
        )
        con.commit()
        con.close()
    except Exception as e:
        print("sqlite skip", e)
    print(json.dumps({"round": last_round, "points": len(hist), "listed": listed, "due": due}))


if __name__ == "__main__":
    main()
