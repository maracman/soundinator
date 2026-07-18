#!/usr/bin/env python3
"""Rebuild the owner's SG2 listening page from the latest leaderboard bests.

Scans SG2_DATA/campaigns/* for reference sets, resolves each
instrument's current best parameters (leaderboard `best.params` inline,
falling back to `<inst>/<run>/best.json` wrappers and flat params files),
renders any stale notes through scripts/render_note.mjs, and writes
SG2_DATA/listen.html.

Renders are cached per instrument by (params hash, engine commit, measured
profile hash): nothing re-renders unless the best params or audible engine
state changed. Instruments with
references but no leaderboard best (e.g. pre-campaign strings) render a
clearly-tagged BASELINE from the bare measured profile.

Run from the engine checkout whose sound you want on the page:
    python3 scripts/sg2_listen_page.py            # current dir's engine
Agents: run this at the end of every pass (owner-facing contract).
"""
import hashlib, html, json, os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.tone_match.paths import sg2_data_root

# Durable artifact root (2026-07-16 incident: /private/tmp was reaped twice,
# destroying corpus + campaign state). Resolved through
# scripts/tone_match/paths.sg2_data_root; override with SG2_DATA.
SG2 = str(sg2_data_root())
NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]

def nname(m): return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"

def engine_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"

def measured_profile_hash():
    path = "web/static/measured_profiles.js"
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return "missing"

def unwrap(obj):
    if not isinstance(obj, dict): return None
    if "excitationType" in obj or "spectralProfile" in obj: return obj
    if isinstance(obj.get("paramsByVowel"), dict):
        return {"paramsByVowel": {v: unwrap(p) for v, p in obj["paramsByVowel"].items() if unwrap(p)}}
    if isinstance(obj.get("params"), dict): return unwrap(obj["params"])
    return None

def params_for_ref(params, ref):
    """Flat params, or per-vowel selection for sung paramsByVowel bests."""
    by_vowel = params.get("paramsByVowel") if isinstance(params, dict) else None
    if not by_vowel: return params
    v = ref.get("vowel")
    return by_vowel.get(v) or next(iter(by_vowel.values()))

def selected_audition_manifest(best):
    """Return reference→SHIP audio for a leaderboard-selected sung audition."""
    # §2.5c.6(c) is stronger than the convenience of an already-rendered
    # audition: a normal page build must draw fresh SHIP seeds.  Only the
    # explicit --cached mode may reuse a selected manifest's audio.
    if FRESH:
        return {}
    scores = best.get("scoresPath") if isinstance(best, dict) else None
    if not scores:
        return {}
    manifest = os.path.join(os.path.dirname(scores), "audition-manifest.json")
    if not os.path.exists(manifest):
        return {}
    return {
        row["reference"]: row["render"]
        for row in json.load(open(manifest))
        if row.get("reference") and row.get("render")
    }

def resolve_best(inst):
    """Return (params, label, selected audition audio by reference)."""
    lb_path = f"{SG2}/{inst}/leaderboard.json"
    for cand in (lb_path, f"{SG2}/state/{inst}/leaderboard.json"):
        if os.path.exists(cand):
            lb_path = cand
            break
    if os.path.exists(lb_path):
        best = (json.load(open(lb_path)).get("best") or {})
        run = best.get("run") or best.get("runId") or best.get("name") or "?"
        p = unwrap(best)
        if p: return p, f"{run} (leaderboard)", selected_audition_manifest(best)
        for cand in (f"{SG2}/state/{inst}/{run}/best.json",
                     f"{SG2}/runs/{inst}/{run}/best.json"):
            if os.path.exists(cand):
                p = unwrap(json.load(open(cand)))
                if p: return p, f"{run} (leaderboard)", selected_audition_manifest(best)
    # newest best.json anywhere under the instrument's dirs (incl. runs/ and state/)
    cands = []
    for base in (f"{SG2}/{inst}", f"{SG2}/runs/{inst}", f"{SG2}/state/{inst}"):
        for root, _dirs, files in os.walk(base):
            if "best.json" in files: cands.append(os.path.join(root, "best.json"))
    for cand in sorted(cands, key=os.path.getmtime, reverse=True):
        p = unwrap(json.load(open(cand)))
        if p: return p, f"{os.path.basename(os.path.dirname(cand))} (newest best)", {}
    return None, None, {}

def resolve_pinned_ship_candidate(inst):
    """Prefer a verified non-neutral pinned-component SHIP candidate.

    This does not promote or rewrite the identity leaderboard. It prevents the
    listening page from silently rendering a pre-L17 leaderboard row whose
    omitted exact-neutral control would mute an installed measured component.
    """
    audit_path = f"{SG2}/state/{inst}/pinned-component-activation-l17.json"
    if not os.path.exists(audit_path): return None
    audit = json.load(open(audit_path))
    params_path = audit.get("paramsFile")
    if not audit.get("passed") or not params_path or not os.path.exists(params_path):
        raise RuntimeError(f"{inst}: invalid pinned-component SHIP activation audit")
    params = unwrap(json.load(open(params_path)))
    if not params:
        raise RuntimeError(f"{inst}: pinned-component SHIP params are not renderable")
    active = [row for row in audit.get("components", [])
              if row.get("applicable") and row.get("active")]
    if not active:
        raise RuntimeError(f"{inst}: activation audit contains no active component")
    label = audit.get("label") or "pinned-component SHIP (verified)"
    return params, label, {}

def resolve_complete_struck_ship_candidate(inst):
    """Prefer a PCM-verified L16+L17+L18 struck SHIP candidate.

    A pass report may select the exact preset used by its output audit without
    rewriting an older identity leaderboard.  Every named mechanism must have
    passed independently; a partial or stale report is a hard error rather
    than a silent fallback to the legacy preset.
    """
    audit_path = f"{SG2}/state/{inst}/complete-struck-ship-pass19.json"
    if not os.path.exists(audit_path): return None
    audit = json.load(open(audit_path))
    params_path = audit.get("paramsFile")
    required = ("actionNoiseLead", "anomalyClasses", "freeDecayHold",
                "fittedDamperRelease")
    gates = audit.get("gates") or {}
    if (not audit.get("passed") or not params_path or
            not os.path.exists(params_path) or
            not all(gates.get(key) is True for key in required)):
        raise RuntimeError(f"{inst}: invalid complete struck SHIP audit")
    params = unwrap(json.load(open(params_path)))
    if not params:
        raise RuntimeError(f"{inst}: complete struck SHIP params are not renderable")
    return params, audit.get("label", "pass19 L16+L17+L18 (PCM verified)"), {}

def baseline_params(inst, refs):
    profile = {"piano-grand": "piano", "guitar-nylon": "guitar"}.get(inst, inst)
    exc = {"violin": "bow", "cello": "bow", "harp": "pluck", "glockenspiel": "strike",
           "piano-grand": "strike", "piano-upright": "strike",
           "guitar-nylon": "pluck", "guitar-steel": "pluck"}.get(inst, "bow")
    return {"voiceMode": "fourier", "spectralMix": 1.0, "spectralPartials": 64,
            "excitationType": exc, "spectralProfile": profile, "seed": 7331}

# §2.5c.6(c): every build is a fresh seeded performance unless --cached.
FRESH = "--cached" not in sys.argv
PAGE_ONLY = "--page-only" in sys.argv
BUILD_SEED = int(time.time()) if FRESH else None

def render_if_stale(inst, params, refs, commit, profile_hash):
    outdir = f"{SG2}/{inst}/listen-live"
    os.makedirs(outdir, exist_ok=True)
    stamp_path = f"{outdir}/stamp.json"
    want = {"paramsHash": hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest(),
            "engine": commit, "measuredProfileHash": profile_hash,
            "buildSeed": BUILD_SEED, "count": len(refs)}
    if os.path.exists(stamp_path) and json.load(open(stamp_path)) == want \
       and all(os.path.exists(f"{outdir}/note-{i}.wav") for i in range(len(refs))):
        return False
    def job_params(r, i):
        p = dict(params_for_ref(params, r))
        if BUILD_SEED is not None: p["seed"] = BUILD_SEED + i * 7919
        return p
    jobs = [{"params": job_params(r, i), "midi": r["midi"], "velocity": r["velocity"],
             "durationSec": r["durationSec"], "sampleRate": 48000,
             "out": f"{outdir}/.new-note-{i}.wav"} for i, r in enumerate(refs)]
    jobs_path = f"{outdir}/jobs.json"
    json.dump(jobs, open(jobs_path, "w"))
    # Agents merge to the served branch continuously; a batch can catch a
    # mid-merge engine state. Retry twice with a pause before failing.
    for attempt in range(3):
        r = subprocess.run(["node", "scripts/render_note.mjs", "--batch", jobs_path],
                           capture_output=True)
        if r.returncode == 0: break
        if attempt < 2: time.sleep(25)
    else:
        raise subprocess.CalledProcessError(r.returncode, r.args,
                                            output=r.stdout, stderr=r.stderr)
    for i in range(len(refs)):
        os.replace(f"{outdir}/.new-note-{i}.wav", f"{outdir}/note-{i}.wav")
    json.dump(want, open(stamp_path, "w"))
    return True

def main():
    commit = engine_commit()
    profile_hash = measured_profile_hash()
    sections, rendered = [], []
    insts = sorted(d for d in os.listdir(f"{SG2}/campaigns")
                   if os.path.exists(f"{SG2}/campaigns/{d}/references.json"))
    for inst in insts:
        refs = json.load(open(f"{SG2}/campaigns/{inst}/references.json"))
        params, label, audition_audio = resolve_best(inst)
        pinned_ship = (resolve_complete_struck_ship_candidate(inst) or
                       resolve_pinned_ship_candidate(inst))
        if pinned_ship: params, label, audition_audio = pinned_ship
        tag, style = (label, "background:#2a3d2a;color:#9fd89f") if params else \
                     ("BASELINE — no fitted preset yet", "background:#3d332a;color:#d8bd9f")
        if not params: params = baseline_params(inst, refs)
        try:
            if not PAGE_ONLY and not audition_audio and render_if_stale(
                    inst, params, refs, commit, profile_hash):
                rendered.append(inst)
        except subprocess.CalledProcessError as e:
            sections.append(f"<h2>{inst}</h2><p class=dim>render failed: {html.escape(str(e))}</p>")
            continue
        rows = sorted(((audition_audio.get(r.get("path"),
                                           f"{inst}/listen-live/note-{i}.wav"), r)
                       for i, r in enumerate(refs)
                       if (r.get("path") in audition_audio if audition_audio else
                           r.get("role") in (None, "spectral", "onset", "vibrato"))),
                      key=lambda p: (p[1].get("vowel", ""), p[1]["midi"], p[1].get("dynamic", ""), p[1].get("string", "")))
        body = [f"<h2>{inst}<span class=tag style='{style}'>{html.escape(tag)}</span></h2>"
                "<table><tr><th>Note</th><th>Register · dynamic</th><th>Reference (real)</th>"
                "<th>Render (synth)</th><th class=dim>Source</th></tr>"]
        def audio_cell(path, base=None):
            """Absolute-resolved player, or a dim placeholder — never a dead link.
            Relative reference paths resolve against their campaign dir, then SG2."""
            if not path: return "<td class=dim>—</td>"
            cands = [path] if os.path.isabs(path) else [
                os.path.normpath(os.path.join(base or SG2, path)),
                os.path.normpath(os.path.join(SG2, path)),
                os.path.normpath(os.path.join(SG2, "campaigns", inst, path))]
            if "sg2-data/" in path:  # wandering-relative agent paths: re-root at the data dir
                cands.append(os.path.join(os.path.dirname(SG2), path[path.index("sg2-data/"):]))
            for c in cands:
                if os.path.exists(c):
                    return f"<td><audio controls preload=none src='file://{html.escape(c)}'></audio></td>"
            return "<td class=dim>missing</td>"
        camp_dir = f"{SG2}/campaigns/{inst}"
        for w, r in rows:
            extra = "".join(f"{r[k]} · " for k in ("vowel", "string") if r.get(k))
            body.append(
                f"<tr><td><b>{nname(r['midi'])}</b></td><td>{extra}{r['register']} · {r['dynamic']}</td>"
                f"{audio_cell(r.get('path'), camp_dir)}"
                f"{audio_cell(w)}"
                f"<td class=dim>{html.escape(r.get('sourceFile',''))}</td></tr>")
        body.append("</table>")
        sections.append("\n".join(body))
    auxiliary = []
    for manifest in Path(SG2, "runs").glob("**/consonant-listening-manifest.json"):
        auxiliary.append((manifest.stat().st_mtime, manifest))
    if auxiliary:
        _mtime, manifest_path = max(auxiliary)
        manifest = json.load(open(manifest_path))
        baseline = manifest["baseline"]
        body = [
            f"<h2>{html.escape(manifest['title'])}<span class=tag "
            "style='background:#3d382a;color:#e7ce88'>AUXILIARY FIT — NOT IDENTITY LEADER</span></h2>",
            f"<p class=dim>{html.escape(manifest['status'])}; compare each fitted "
            "onset with the same-seed vowel-only output.</p>",
            "<table><tr><th>Class</th><th>Vowel-only onset</th><th>Consonant onset</th></tr>",
        ]
        def aux_cell(path):
            if not path: return "<td class=dim>—</td>"
            cands = [path] if os.path.isabs(path) else [
                os.path.normpath(os.path.join(os.path.dirname(manifest_path), path)),
                os.path.normpath(os.path.join(SG2, path))]
            if "sg2-data/" in str(path):
                cands.append(os.path.join(os.path.dirname(SG2), str(path)[str(path).index("sg2-data/"):]))
            for c in cands:
                if os.path.exists(c):
                    return f"<td><audio controls preload=none src='file://{html.escape(str(c))}'></audio></td>"
            return "<td class=dim>missing</td>"
        for row in manifest["rows"]:
            body.append(
                f"<tr><td><b>{html.escape(row['label'])}</b></td>"
                f"{aux_cell(baseline)}{aux_cell(row['render'])}</tr>"
            )
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
