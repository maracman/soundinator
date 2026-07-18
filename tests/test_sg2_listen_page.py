from __future__ import annotations

import json

import scripts.sg2_listen_page as listen_page


def test_fresh_listening_build_ignores_selected_audition_audio(tmp_path, monkeypatch):
    scores = tmp_path / "run" / "baseline-scores.json"
    scores.parent.mkdir()
    scores.write_text("{}")
    (scores.parent / "audition-manifest.json").write_text(json.dumps([{
        "reference": "/reference.wav",
        "render": "/old-selected-render.wav",
    }]))
    best = {"scoresPath": str(scores)}

    monkeypatch.setattr(listen_page, "FRESH", True)
    assert listen_page.selected_audition_manifest(best) == {}

    monkeypatch.setattr(listen_page, "FRESH", False)
    assert listen_page.selected_audition_manifest(best) == {
        "/reference.wav": "/old-selected-render.wav",
    }
