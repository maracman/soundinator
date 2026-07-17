#!/usr/bin/env python3
"""Owner progress charts: per-criterion loss/gate trajectories across passes.

Reads every sg2-data/runs/<inst>/<run>/summary.json (pass order = mtime),
charts composite loss and per-criterion state over passes, grouped by the
CRITERIA HIERARCHY (owner, 2026-07-17): criteria form a dependency cascade —
an upstream failure corrupts the MEASUREMENT of downstream criteria, so
downstream cells are marked "masked" (measurement suspect), not merely red.

    T0 pitch & partial membership   (pitch lock, inharmonicity, mode ratios)
    T1 spectral amplitudes          (partial table, band balance, mel, centroid)
    T2 temporal envelope & decay    (attack, decay/T60)
    T3 modulation                   (vibrato trajectory, body-AM)
    T4 noise & transients           (onset spectrum/noise, breath/bow floor)
    T5 variation / humanisation     (distributional gate)

Output: sg2-data/progress.html. Run any time: python3 scripts/sg2_progress_page.py
"""
import glob, html, json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from scripts.tone_match.paths import sg2_data_root
SG2 = str(sg2_data_root())

TIERS = [
    ("T0 · pitch & partial membership", ["pitch", "inharmonicity", "mode", "stretch"]),
    ("T1 · spectral amplitudes",        ["partial-table", "partials", "band-balance", "mel", "centroid", "body"]),
    ("T2 · temporal envelope & decay",  ["attack", "decay", "t60", "envelope", "release"]),
    ("T3 · modulation",                 ["vibrato", "am", "tremolo"]),
    ("T4 · noise & transients",         ["noise", "onset", "breath", "scratch", "scoop", "wander", "tilt"]),
    ("T5 · variation / humanisation",   ["variation", "human", "distribution"]),
]

def tier_of(bar):
    b = bar.lower()
    for i, (_name, keys) in enumerate(TIERS):
        if any(k in b for k in keys): return i
    return 1  # default: spectral

def collect(inst):
    """Per pass: composite losses + per-bar pass/fail/na counts."""
    out = []
    for s in sorted(glob.glob(f"{SG2}/runs/{inst}/*/summary.json"), key=os.path.getmtime):
        try: e = json.load(open(s))
        except Exception: continue
        bars = {}
        for c in (e.get("tripwires") or {}).get("cells", []):
            b = c.get("bar", "?"); st = c.get("status", "notApplicable")
            bars.setdefault(b, {"pass": 0, "fail": 0, "notApplicable": 0})
            bars[b][st if st in ("pass", "fail") else "notApplicable"] += 1
        out.append({"run": e.get("run", os.path.basename(os.path.dirname(s))),
                    "loss": e.get("bestLoss"), "baseline": e.get("baselineLoss"),
                    "construction": e.get("constructionPassed"), "bars": bars})
    return out

def spark(vals, width=340, height=44, fmt="{:.2f}"):
    pts = [(i, v) for i, v in enumerate(vals) if v is not None]
    if len(pts) < 1: return "<span class=dim>no data</span>"
    lo = min(v for _, v in pts); hi = max(v for _, v in pts); rng = (hi - lo) or 1
    n = max(len(vals) - 1, 1)
    xy = " ".join(f"{6 + i / n * (width - 12):.1f},{height - 8 - (v - lo) / rng * (height - 16):.1f}" for i, v in pts)
    last = pts[-1][1]
    return (f"<svg width={width} height={height}><polyline points='{xy}' fill='none' "
            f"stroke='#7fd894' stroke-width='2'/><circle cx='{6 + pts[-1][0] / n * (width - 12):.1f}' "
            f"cy='{height - 8 - (last - lo) / rng * (height - 16):.1f}' r='3' fill='#7fd894'/></svg>"
            f"<span class=val>{fmt.format(last)}</span>")

def bar_cells_html(passes, bar):
    cells = []
    for p in passes:
        c = p["bars"].get(bar)
        if not c or (c["pass"] + c["fail"]) == 0: cells.append("<td class='na'>·</td>")
        elif c["fail"] == 0: cells.append(f"<td class='ok'>{c['pass']}✓</td>")
        else: cells.append(f"<td class='bad'>{c['fail']}✗/{c['pass']}✓</td>")
    return "".join(cells)

def main():
    insts = sorted({os.path.basename(os.path.dirname(os.path.dirname(s)))
                    for s in glob.glob(f"{SG2}/runs/*/*/summary.json")})
    secs = []
    for inst in insts:
        passes = collect(inst)
        if not passes: continue
        losses = [p["loss"] for p in passes]
        baselines = [p["baseline"] for p in passes]
        all_bars = sorted({b for p in passes for b in p["bars"]})
        # masking: if any T0 bar fails in the latest pass, downstream tiers are suspect
        latest = passes[-1]
        t0_fail = any(c["fail"] for b, c in latest["bars"].items() if tier_of(b) == 0)
        head = "".join(f"<th>{html.escape(p['run'][:14])}</th>" for p in passes)
        rows = []
        for ti, (tname, _k) in enumerate(TIERS):
            tier_bars = [b for b in all_bars if tier_of(b) == ti]
            if not tier_bars: continue
            mask = " <span class=mask>⚠ masked by T0 failure — measurements suspect</span>" if (t0_fail and ti > 0) else ""
            rows.append(f"<tr class=tier><td colspan={len(passes)+1}>{tname}{mask}</td></tr>")
            for b in tier_bars:
                rows.append(f"<tr><td class=bar>{html.escape(b)}</td>{bar_cells_html(passes, b)}</tr>")
        secs.append(
            f"<h2>{inst}</h2><div class=charts>"
            f"<div><h3>composite loss (lower = better)</h3>{spark(losses)}</div>"
            f"<div><h3>baseline (must beat)</h3>{spark(baselines)}</div></div>"
            f"<table><tr><th>criterion \\ pass</th>{head}</tr>{''.join(rows)}</table>")
    stamp = time.strftime("%Y-%m-%d %H:%M")
    page = ("<!doctype html><meta charset='utf-8'><title>SG2 progress — loss by criterion</title>"
            "<style>body{font-family:system-ui;margin:2em;background:#141518;color:#e8e8e8}"
            "h2{border-bottom:1px solid #333;margin-top:1.6em}h3{color:#9aa;font-size:.8em;margin:4px 0}"
            ".charts{display:flex;gap:3em}.val{color:#7fd894;margin-left:8px;font-weight:600}"
            "table{border-collapse:collapse;margin-top:10px;font-size:.85em}"
            "td,th{padding:3px 9px;border-bottom:1px solid #26282e;text-align:center}"
            "td.bar{text-align:left;color:#bbc}tr.tier td{text-align:left;color:#8fb6d8;font-weight:600;"
            "background:#191c22;padding-top:8px}.ok{color:#7fd894}.bad{color:#e08a8a}.na{color:#555}"
            ".mask{color:#e0b060;font-weight:400;font-size:.85em}.dim{color:#667}</style>"
            f"<h1>SG2 progress — loss & gates by criterion</h1>"
            f"<p class=dim>Auto-built {stamp} · criteria grouped by the dependency hierarchy "
            f"(T0 pitch/partials → T5 humanisation); an upstream T0 failure marks downstream tiers "
            f"as measurement-suspect rather than merely failing. Rebuild: "
            f"<code>python3 scripts/sg2_progress_page.py</code></p>" + "".join(secs))
    open(f"{SG2}/progress.html", "w").write(page)
    print(f"progress.html rebuilt · {len(insts)} instruments")

if __name__ == "__main__":
    sys.exit(main())
