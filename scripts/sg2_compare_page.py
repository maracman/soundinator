#!/usr/bin/env python3
"""Version-comparison listening page: current vs previous bests per instrument.

For each instrument, finds up to N historically distinct best parameter sets
(from runs/*/best.json, state/, and the leaderboard), renders the SAME
reference rows under each with the SAME FIXED SEED (deliberate exception to
the fresh-seed rule: this page isolates PRESET differences — variation draws
would confound version comparison), and writes SG2_DATA/compare.html with
columns: reference | current | previous | 2-back.

Renders cache by (params hash, engine commit): historical versions render
once, ever. Row count per instrument is capped for render economy.

Usage: python3 scripts/sg2_compare_page.py [--only INST] [--versions N]
"""
import glob, hashlib, html, json, os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from scripts.tone_match.paths import sg2_data_root
from scripts.sg2_listen_page import unwrap, params_for_ref, nname, engine_commit
SG2 = str(sg2_data_root())
SEED = 7331
MAX_ROWS = 8

def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default

def phash(p): return hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()[:10]

def version_history(inst, n):
    """Newest-first distinct param sets: (params, label, mtime)."""
    seen, out = set(), []
    cands = []
    for pat in (f"{SG2}/state/{inst}/**/best.json", f"{SG2}/runs/{inst}/*/best.json",
                f"{SG2}/{inst}/*/best.json"):
        cands += glob.glob(pat, recursive=True)
    for path in sorted(set(cands), key=os.path.getmtime, reverse=True):
        try: p = unwrap(json.load(open(path)))
        except Exception: continue
        if not p: continue
        h = phash(p)
        if h in seen: continue
        seen.add(h)
        out.append((p, os.path.basename(os.path.dirname(path)), os.path.getmtime(path)))
        if len(out) >= n: break
    return out

def pick_rows(refs):
    rows = [(i, r) for i, r in enumerate(refs)
            if r.get("role") in (None, "spectral") ]
    if len(rows) > MAX_ROWS:
        step = len(rows) / MAX_ROWS
        rows = [rows[int(k * step)] for k in range(MAX_ROWS)]
    return rows

def render_version(inst, params, rows):
    h = phash(params)
    outdir = f"{SG2}/{inst}/versions/{h}"
    os.makedirs(outdir, exist_ok=True)
    if all(os.path.exists(f"{outdir}/note-{i}.wav") for i, _ in rows):
        return outdir
    jobs = []
    for i, r in rows:
        p = dict(params_for_ref(params, r)); p["seed"] = SEED
        jobs.append({"params": p, "midi": r["midi"], "velocity": r["velocity"],
                     "durationSec": r["durationSec"], "sampleRate": 48000,
                     "out": f"{outdir}/note-{i}.wav"})
    jp = f"{outdir}/jobs.json"; json.dump(jobs, open(jp, "w"))
    for attempt in range(3):
        res = subprocess.run(["node", "scripts/render_note.mjs", "--batch", jp],
                             capture_output=True, cwd=ROOT)
        if res.returncode == 0: return outdir
        if attempt < 2: time.sleep(20)
    return None

def main():
    only = arg("--only"); nvers = int(arg("--versions", 3))
    commit = engine_commit()
    insts = sorted(d for d in os.listdir(f"{SG2}/campaigns")
                   if os.path.exists(f"{SG2}/campaigns/{d}/references.json"))
    if only: insts = [i for i in insts if i == only]
    secs = []
    for inst in insts:
        refs = json.load(open(f"{SG2}/campaigns/{inst}/references.json"))
        rows = pick_rows(refs)
        vers = version_history(inst, nvers)
        if not vers: continue
        rendered = []
        for p, label, ts in vers:
            d = render_version(inst, p, rows)
            if d: rendered.append((d, label, time.strftime("%m-%d %H:%M", time.localtime(ts))))
        if not rendered: continue
        heads = "".join(f"<th>{'CURRENT · ' if k==0 else f'prev{k} · '}{html.escape(lab)}"
                        f"<div class=dim>{ts}</div></th>" for k, (_, lab, ts) in enumerate(rendered))
        body = [f"<h2>{inst}</h2><table><tr><th>note</th><th>reference</th>{heads}</tr>"]
        for i, r in rows:
            cells = "".join(
                f"<td><audio controls preload=none src='file://{d}/note-{i}.wav'></audio></td>"
                for d, _, _ in rendered)
            body.append(f"<tr><td><b>{nname(r['midi'])}</b> {r.get('vowel','')} "
                        f"{r['register']}·{r['dynamic']}</td>"
                        f"<td><audio controls preload=none src='file://{r['path']}'></audio></td>{cells}</tr>")
        body.append("</table>")
        secs.append("\n".join(body))
    stamp = time.strftime("%Y-%m-%d %H:%M")
    page = ("<!doctype html><meta charset='utf-8'><title>SG2 versions — direction check</title>"
            "<style>body{font-family:system-ui;margin:2em;background:#141518;color:#e8e8e8}"
            "h2{border-bottom:1px solid #333;margin-top:1.5em}table{border-collapse:collapse;font-size:.85em}"
            "td,th{padding:4px 8px;border-bottom:1px solid #26282e;text-align:left;vertical-align:top}"
            "audio{width:190px;height:30px}.dim{color:#9aa;font-weight:400;font-size:.8em}</style>"
            f"<h1>SG2 version comparison</h1><p class=dim>Built {stamp} · engine {commit} · "
            f"SAME fixed seed across versions (preset differences only) · newest left · rebuild: "
            f"<code>python3 scripts/sg2_compare_page.py [--only inst]</code></p>" + "".join(secs))
    open(f"{SG2}/compare.html", "w").write(page)
    print(f"compare.html rebuilt · {len(secs)} instruments")

if __name__ == "__main__":
    sys.exit(main())
