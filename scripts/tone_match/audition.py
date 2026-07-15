"""Build a self-contained randomized A/B/X audition page from a JSON manifest."""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path


def _data_uri(path: str) -> str:
    suffix = Path(path).suffix.lower()
    mime = "audio/wav" if suffix == ".wav" else "audio/mpeg"
    return f"data:{mime};base64,{base64.b64encode(Path(path).read_bytes()).decode()}"


def build(manifest_path: str, output_path: str) -> None:
    manifest = json.loads(Path(manifest_path).read_text())
    trials = [{**item, "reference": _data_uri(item["reference"]), "render": _data_uri(item["render"])} for item in manifest]
    data = json.dumps(trials).replace("</", "<\\/")
    Path(output_path).write_text(f"""<!doctype html><meta charset=\"utf-8\"><title>SG2 blind A/B/X</title>
<style>body{{font:16px system-ui;max-width:760px;margin:40px auto}}button{{padding:10px 16px;margin:5px}}#result{{white-space:pre-wrap}}</style>
<h1>Sound Generator 2.0 — blind A/B/X</h1><p id=progress></p><h2 id=label></h2><div id=players></div>
<p><button data-v=\"A\">X is A</button><button data-v=\"B\">X is B</button><button data-v=\"unsure\">Unsure</button></p><button id=save hidden>Save verdicts JSON</button><pre id=result></pre>
<script>const trials={data};let i=0,answers=[];for(const t of trials){{if(Math.random()<.5){{t.A=t.reference;t.B=t.render;t.answer='A'}}else{{t.A=t.render;t.B=t.reference;t.answer='B'}}t.X=t.reference}}function show(){{if(i>=trials.length){{progress.textContent='Complete';players.innerHTML='';save.hidden=false;result.textContent=JSON.stringify(answers,null,2);return}}const t=trials[i];progress.textContent=`Trial ${{i+1}} / ${{trials.length}}`;label.textContent=t.label||t.instrument||'';players.innerHTML=['A','B','X'].map(k=>`<p><b>${{k}}</b> <audio controls src=\"${{t[k]}}\"></audio></p>`).join('')}}document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{{const t=trials[i];answers.push({{label:t.label||t.instrument,verdict:b.dataset.v,correct:b.dataset.v===t.answer}});i++;show()}});save.onclick=()=>{{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(answers,null,2)],{{type:'application/json'}}));a.download='sg2-audition-verdicts.json';a.click()}};show();</script>""", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    build(args.manifest, args.out)


if __name__ == "__main__":
    main()
