#!/usr/bin/env python3
"""SG2 owner dashboard — one page, three tabs: Fleet | Listen | Progress.

- FLEET: which agent lanes are running now, per-instrument current best vs
  legacy baseline, gate pass/fail counts from the latest run summary.
- LISTEN: embeds sg2-data/listen.html (kept fresh by agents at pass end;
  pass --render to force a fresh-seeded rebuild now).
- PROGRESS: rebuilds and embeds progress.html (per-criterion trajectories).

Usage: python3 scripts/sg2_dashboard.py [--render]
"""
import glob, html, json, os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from scripts.tone_match.paths import sg2_data_root
SG2 = str(sg2_data_root())

def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, shell=True).stdout

def fleet_rows():
    procs = sh("ps -o etime,command -ax | grep 'codex exec' | grep -v grep")
    lanes = {}
    for line in procs.splitlines():
        for lane in ("a-engine", "c-struck", "d-analysis", "e-sung"):
            if f"worktrees/{lane}" in line:
                lanes[lane] = line.split()[0]
    return lanes

def latest_summary(inst):
    cands = sorted(glob.glob(f"{SG2}/runs/{inst}/*/summary.json"), key=os.path.getmtime)
    if not cands: return None, None
    try: return json.load(open(cands[-1])), os.path.getmtime(cands[-1])
    except Exception: return None, None

def instrument_rows():
    rows = []
    for lb_path in sorted(glob.glob(f"{SG2}/state/*/leaderboard.json")):
        inst = os.path.basename(os.path.dirname(lb_path))
        try: lb = json.load(open(lb_path))
        except Exception: continue
        best = lb.get("best") or {}
        legacy = None
        for e in [best] + (lb.get("history") or []):
            if "legacy" in str(e.get("run", "")).lower() or "legacy" in str(e.get("priorRow", "")).lower():
                legacy = e.get("loss"); break
        loss = best.get("loss") or best.get("meanComposite")
        s, ts = latest_summary(inst)
        gates = ""
        if s:
            c = (s.get("tripwires") or {}).get("counts") or {}
            gates = f"{c.get('pass',0)}✓ / {c.get('fail',0)}✗"
            constr = s.get("constructionPassed")
            gates += " · constr " + ("✓" if constr else "✗")
        delta = ""
        if loss is not None and legacy:
            d = (legacy - loss) / legacy * 100
            delta = f"<span class='{'ok' if d > 0 else 'bad'}'>{d:+.1f}% vs legacy</span>"
        age = f"{(time.time()-ts)/3600:.1f}h ago" if ts else "—"
        rows.append(f"<tr><td>{inst}</td><td>{best.get('run','—')}</td>"
                    f"<td>{f'{loss:.3f}' if loss is not None else '—'}</td><td>{delta}</td>"
                    f"<td>{gates}</td><td class=dim>{age}</td></tr>")
    return rows

def main():
    if "--render" in sys.argv:
        subprocess.run([sys.executable, "scripts/sg2_listen_page.py"], cwd=ROOT)
    subprocess.run([sys.executable, "scripts/sg2_progress_page.py"], cwd=ROOT,
                   capture_output=True)
    lanes = fleet_rows()
    lane_html = " ".join(
        f"<span class='lane {'on' if l in lanes else 'off'}'>{l}"
        f"{' · ' + lanes[l] if l in lanes else ' · idle'}</span>"
        for l in ("a-engine", "c-struck", "d-analysis", "e-sung"))
    stamp = time.strftime("%Y-%m-%d %H:%M")
    page = f"""<!doctype html><meta charset='utf-8'><title>SG2 dashboard</title>
<style>body{{font-family:system-ui;margin:0;background:#141518;color:#e8e8e8}}
header{{padding:12px 24px;border-bottom:1px solid #333}}
h1{{font-size:1.1em;margin:0 0 6px}} .dim{{color:#9aa}}
.lane{{padding:2px 10px;border-radius:9px;margin-right:8px;font-size:.8em}}
.lane.on{{background:#22331f;color:#9fd89f}}.lane.off{{background:#2a2a2e;color:#777}}
nav button{{background:#1d2026;color:#dde;border:1px solid #333;padding:6px 18px;
margin:10px 8px 0 0;border-radius:6px;cursor:pointer}}nav button.sel{{background:#2a3d2a;color:#9fd89f}}
table{{border-collapse:collapse;margin:14px 24px;font-size:.9em}}
td,th{{padding:5px 12px;border-bottom:1px solid #26282e;text-align:left}}
.ok{{color:#7fd894}}.bad{{color:#e08a8a}}
iframe{{width:100%;height:calc(100vh - 130px);border:0;background:#141518}}
section{{display:none}}section.sel{{display:block}}</style>
<header><h1>SG2 dashboard <span class=dim>· built {stamp} · rebuild:
<code>python3 scripts/sg2_dashboard.py [--render]</code></span></h1>
<div>{lane_html}</div>
<nav><button data-t=fleet class=sel>Fleet</button><button data-t=listen>Listen</button>
<button data-t=progress>Progress</button><button data-t=versions>Versions</button></nav></header>
<section id=fleet class=sel><table>
<tr><th>instrument</th><th>current best</th><th>loss</th><th>vs legacy</th>
<th>gates (latest pass)</th><th>updated</th></tr>
{''.join(instrument_rows())}</table>
<p class=dim style='margin:0 24px'>gates = tripwire cells ✓/✗ + construction, from each
instrument's latest run summary. Full per-criterion history in the Progress tab.</p></section>
<section id=listen><iframe src='listen.html'></iframe></section>
<section id=progress><iframe src='progress.html'></iframe></section>
<section id=versions><iframe src='compare.html'></iframe></section>
<script>document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{{
document.querySelectorAll('nav button,section').forEach(x=>x.classList.remove('sel'));
b.classList.add('sel');document.getElementById(b.dataset.t).classList.add('sel');}});</script>"""
    open(f"{SG2}/dashboard.html", "w").write(page)
    print(f"dashboard.html rebuilt · lanes running: {sorted(fleet_rows())}")

if __name__ == "__main__":
    sys.exit(main())
