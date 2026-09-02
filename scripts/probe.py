#!/usr/bin/env python3
"""Unsigned TestNet pulse sample. No execute. Skip 81. Never poke 87."""
import json, urllib.request, ssl
from datetime import datetime, timezone
from pathlib import Path

ALGOD = "https://testnet-api.algonode.cloud"
KEEPER = 769891898
SKIP = {81}
ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "arcron-pulse"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())

def main():
    st = get(ALGOD + "/v2/status")
    last_round = st.get("last-round")
    app = get(ALGOD + "/v2/applications/%s" % KEEPER)
    params = (app.get("params") or {})
    gs = {x["key"]: x["value"] for x in (params.get("global-state") or [])}
    # keys are b64; keep raw plus decoded names we know from due.json boards
    sample = {
        "t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "round": last_round,
        "listed": None,
        "due": None,
        "skipped": 1,
        "unfunded": None,
        "waiting": None,
        "on_schedule": None,
        "escrow_micro": params.get("min-balance") or None,
        "source": "probe.py unsigned algod",
        "keeper": KEEPER,
        "genesis": st.get("genesis-id"),
        "skip": sorted(SKIP),
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
    (DOCS / "live.json").write_text(json.dumps({"round": last_round, "keeper": KEEPER, "genesis": st.get("genesis-id"), "t": sample["t"], "global_state_keys": list(gs.keys())[:12], "skip": sorted(SKIP)}, indent=2) + "\n")
    try:
        import sqlite3
        dbp = DOCS / "pulse.sqlite"
        con = sqlite3.connect(dbp)
        con.execute("CREATE TABLE IF NOT EXISTS samples (t TEXT, round INTEGER, listed INTEGER, due INTEGER, skipped INTEGER, unfunded INTEGER, waiting INTEGER, on_schedule INTEGER, escrow_micro INTEGER, source TEXT)")
        con.execute("DELETE FROM samples")
        con.executemany("INSERT INTO samples VALUES (?,?,?,?,?,?,?,?,?,?)",
            [(h.get("t"), h.get("round"), h.get("listed"), h.get("due"), h.get("skipped"), h.get("unfunded"), h.get("waiting"), h.get("on_schedule"), h.get("escrow_micro"), h.get("source")) for h in hist])
        con.commit(); con.close()
    except Exception as e:
        print("sqlite skip", e)
    print(json.dumps({"round": last_round, "points": len(hist)}))

if __name__ == "__main__":
    main()
