#!/usr/bin/env python3
"""Rebuild the owner's SG2 listening page from the latest leaderboard bests.

Scans /private/tmp/sg2/campaigns/* for reference sets, resolves each
instrument's current best parameters (leaderboard `best.params` inline,
falling back to `<inst>/<run>/best.json` wrappers and flat params files),
renders any stale notes through scripts/render_note.mjs, and writes
/private/tmp/sg2/listen.html.

Renders are cached per instrument by (params hash, engine commit): nothing
re-renders unless the best params or the engine changed. Instruments with
references but no leaderboard best (e.g. pre-campaign strings) render a
clearly-tagged BASELINE from the bare measured profile.

Run from the engine checkout whose sound you want on the page:
    python3 scripts/sg2_listen_page.py            # current dir's engine
Agents: run this at the end of every pass (owner-facing contract).
"""
import hashlib, html, json, os, subprocess, sys, time

SG2 = "/private/tmp/sg2"
NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]

def nname(m): return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"

def engine_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"

def unwrap(obj):
    if not isinstance(obj, dict): return None
    if "excitationType" in obj or "spectralProfile" in obj: return obj
    if isinstance(obj.get("params"), dict): return unwrap(obj["params"])
    return None

def resolve_best(inst):
    """Return (params, label) or (None, None)."""
    lb_path = f"{SG2}/{inst}/leaderboard.json"
    if os.path.exists(lb_path):
        best = (json.load(open(lb_path)).get("best") or {})
        run = best.get("run") or best.get("runId") or best.get("name") or "?"
        p = unwrap(best)
        if p: return p, f"{run} (leaderboard)"
        for cand in (f"{SG2}/{inst}/{run}/best.json", f"{SG2}/refit-wave/{run}/best.json"):
            if os.path.exists(cand):
                p = unwrap(json.load(open(cand)))
                if p: return p, f"{run} (leaderboard)"
    # newest best.json anywhere under the instrument
    cands = []
    for root, _dirs, files in os.walk(f"{SG2}/{inst}"):
        if "best.json" in files: cands.append(os.path.join(root, "best.json"))
    for cand in sorted(cands, key=os.path.getmtime, reverse=True):
        p = unwrap(json.load(open(cand)))
        if p: return p, f"{os.path.basename(os.path.dirname(cand))} (newest best)"
    return None, None

def baseline_params(inst, refs):
    profile = {"piano-grand": "piano", "guitar-nylon": "guitar"}.get(inst, inst)
    exc = {"violin": "bow", "cello": "bow", "harp": "pluck", "glockenspiel": "strike",
           "piano-grand": "strike", "piano-upright": "strike",
           "guitar-nylon": "pluck", "guitar-steel": "pluck"}.get(inst, "bow")
    return {"voiceMode": "fourier", "spectralMix": 1.0, "spectralPartials": 64,
            "excitationType": exc, "spectralProfile": profile, "seed": 7331}

def render_if_stale(inst, params, refs, commit):
    outdir = f"{SG2}/{inst}/listen-live"
    os.makedirs(outdir, exist_ok=True)
    stamp_path = f"{outdir}/stamp.json"
    want = {"paramsHash": hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest(),
            "engine": commit, "count": len(refs)}
    if os.path.exists(stamp_path) and json.load(open(stamp_path)) == want \
       and all(os.path.exists(f"{outdir}/note-{i}.wav") for i in range(len(refs))):
        return False
    jobs = [{"params": params, "midi": r["midi"], "velocity": r["velocity"],
             "durationSec": r["durationSec"], "sampleRate": 48000,
             "out": f"{outdir}/note-{i}.wav"} for i, r in enumerate(refs)]
    jobs_path = f"{outdir}/jobs.json"
    json.dump(jobs, open(jobs_path, "w"))
    subprocess.run(["node", "scripts/render_note.mjs", "--batch", jobs_path],
                   check=True, capture_output=True)
    json.dump(want, open(stamp_path, "w"))
    return True

def main():
    commit = engine_commit()
    sections, rendered = [], []
    insts = sorted(d for d in os.listdir(f"{SG2}/campaigns")
                   if os.path.exists(f"{SG2}/campaigns/{d}/references.json"))
    for inst in insts:
        refs = json.load(open(f"{SG2}/campaigns/{inst}/references.json"))
        params, label = resolve_best(inst)
        tag, style = (label, "background:#2a3d2a;color:#9fd89f") if params else \
                     ("BASELINE — no fitted preset yet", "background:#3d332a;color:#d8bd9f")
        if not params: params = baseline_params(inst, refs)
        try:
            if render_if_stale(inst, params, refs, commit): rendered.append(inst)
        except subprocess.CalledProcessError as e:
            sections.append(f"<h2>{inst}</h2><p class=dim>render failed: {html.escape(str(e))}</p>")
            continue
        rows = sorted(((f"{inst}/listen-live/note-{i}.wav", r) for i, r in enumerate(refs)),
                      key=lambda p: (p[1]["midi"], p[1].get("dynamic", ""), p[1].get("string", "")))
        body = [f"<h2>{inst}<span class=tag style='{style}'>{html.escape(tag)}</span></h2>"
                "<table><tr><th>Note</th><th>Register · dynamic</th><th>Reference (real)</th>"
                "<th>Render (synth)</th><th class=dim>Source</th></tr>"]
        for w, r in rows:
            extra = f"{r.get('string','')} · " if r.get("string") else ""
            body.append(
                f"<tr><td><b>{nname(r['midi'])}</b></td><td>{extra}{r['register']} · {r['dynamic']}</td>"
                f"<td><audio controls preload=none src='file://{r['path']}'></audio></td>"
                f"<td><audio controls preload=none src='file://{SG2}/{html.escape(w)}'></audio></td>"
                f"<td class=dim>{html.escape(r.get('sourceFile',''))}</td></tr>")
        body.append("</table>")
        sections.append("\n".join(body))
    stamp = time.strftime("%Y-%m-%d %H:%M")
    page = ("<!doctype html><meta charset='utf-8'><title>SG2 listening — render vs reference</title>"
            "<style>body{font-family:system-ui;margin:2em;background:#141518;color:#e8e8e8}"
            "h2{border-bottom:1px solid #333;padding-bottom:4px;margin-top:2em}"
            "table{border-collapse:collapse;width:100%}td,th{padding:6px 10px;text-align:left;"
            "border-bottom:1px solid #26282e}audio{width:230px;height:32px}.dim{color:#9aa}"
            ".tag{font-size:.65em;padding:2px 8px;border-radius:9px;margin-left:8px}</style>"
            f"<h1>Sound Generator 2.0 — render vs reference</h1>"
            f"<p class=dim>Auto-built {stamp} · engine {commit} · re-rendered this build: "
            f"{', '.join(rendered) if rendered else 'none (all cached)'} · regenerate with "
            f"<code>python3 scripts/sg2_listen_page.py</code></p>" + "\n".join(sections))
    open(f"{SG2}/listen.html", "w").write(page)
    print(f"listen.html rebuilt · engine {commit} · {len(insts)} instruments · re-rendered: {rendered or 'none'}")

if __name__ == "__main__":
    sys.exit(main())
