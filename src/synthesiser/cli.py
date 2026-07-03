"""Command line interface for rendering and inspecting stimuli."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synthesiser.experiment_runner import DryRunExperimentRunner
from synthesiser.modes import (
    ModeAConfig,
    ModeBConfig,
    ModeCConfig,
    ModeDConfig,
    ModeEConfig,
    ModeFConfig,
    ModeGConfig,
    ModeHConfig,
    ModeIConfig,
    generate_mode_a_events,
    generate_mode_b_events,
    generate_mode_c_events,
    generate_mode_d_events,
    generate_mode_e_events,
    generate_mode_f_familiarisation,
    generate_mode_f_probe,
    generate_mode_g_events,
    generate_mode_h_events,
    generate_mode_i_trial_spec,
    MODEH_CONDITIONS,
)
from synthesiser.pipeline import RenderPipelineConfig, RenderingPipeline
from synthesiser.renderers.pitched import PitchedRenderer, PitchedRendererConfig
from synthesiser.renderers.vocalisation import VocalisationRenderer, VocalisationRendererConfig


def _pitched_pipeline(seed: int, sr: int, lufs: float, peak: float):
    renderer = PitchedRenderer(PitchedRendererConfig(sample_rate=sr, random_seed=seed))
    pipeline = RenderingPipeline(
        renderer, RenderPipelineConfig(sample_rate=sr, target_lufs=lufs, peak_db=peak),
    )
    return pipeline


def _vocal_pipeline(seed: int, sr: int, lufs: float, peak: float):
    renderer = VocalisationRenderer(VocalisationRendererConfig(sample_rate=sr, random_seed=seed))
    pipeline = RenderingPipeline(
        renderer, RenderPipelineConfig(sample_rate=sr, target_lufs=lufs, peak_db=peak),
    )
    return pipeline


def export_data(args: argparse.Namespace) -> None:
    from synthesiser.web.export import export_all

    written = export_all(Path(args.data_dir), Path(args.out))
    for name, path in written.items():
        lines = max(0, path.read_text(encoding="utf-8").count("\n") - 1)
        print(f"  {name:<14} {lines:>6} rows  -> {path}")


def _report(stimulus_id: str, sidecar: dict, extra: str = "") -> None:
    qc = sidecar["qc"]
    parts = [
        f"{stimulus_id}: events={qc['event_count']}",
        f"peak={qc['peak_dbfs']:.2f} dBFS",
        f"rms={qc['rms_dbfs']:.2f} dBFS",
    ]
    if extra:
        parts.append(extra)
    print(", ".join(parts))


# -------------------------------------------------------------------

def render_mode_a(args: argparse.Namespace) -> None:
    output = Path(args.output)
    for level in range(5):
        seed = args.seed + level
        config = ModeAConfig.default(sigma_level=level)
        events = generate_mode_a_events(config, seed=seed)
        pipeline = _vocal_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
        sid = f"mode_a_sigma{level}_{seed:04d}"
        sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=seed)
        _report(sid, sidecar, f"sigma_level={level}")


def render_mode_b(args: argparse.Namespace) -> None:
    output = Path(args.output)
    for condition in ("affective", "phonemic"):
        seed = args.seed
        config = ModeBConfig.default(condition=condition)
        events = generate_mode_b_events(config, seed=seed)
        pipeline = _vocal_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
        sid = f"mode_b_{condition}_{seed:04d}"
        sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=seed)
        _report(sid, sidecar, f"condition={condition}")


def render_mode_c(args: argparse.Namespace) -> None:
    placements = ["on_beat", "pre_beat", "off_beat"]
    output = Path(args.output)
    for trial in range(args.trials):
        placement = placements[trial % len(placements)] if args.placement == "cycle" else args.placement
        seed = args.seed + trial
        config = ModeCConfig.default(placement=placement)
        events = generate_mode_c_events(config, seed=seed)
        pipeline = _pitched_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
        sid = f"mode_c_{trial:03d}"
        sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=seed)
        _report(sid, sidecar, f"placement={placement}")


def render_mode_d(args: argparse.Namespace) -> None:
    output = Path(args.output)
    seed = args.seed
    config = ModeDConfig.default()
    events = generate_mode_d_events(config, seed=seed)
    pipeline = _pitched_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
    sid = f"mode_d_{seed:04d}"
    sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                       metadata=config.to_metadata(), seed=seed)
    violations = sum(1 for ev in sidecar["events"] if ev.get("tags", {}).get("violation"))
    _report(sid, sidecar, f"violations={violations}")


def render_mode_e(args: argparse.Namespace) -> None:
    output = Path(args.output)
    for level in range(5):
        seed = args.seed + level
        config = ModeEConfig.default(sigma_level=level)
        events = generate_mode_e_events(config, seed=seed)
        pipeline = _vocal_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
        sid = f"mode_e_sigma{level}_{seed:04d}"
        sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=seed)
        _report(sid, sidecar, f"sigma_level={level}")


def render_mode_f(args: argparse.Namespace) -> None:
    output = Path(args.output)
    seed = args.seed
    config = ModeFConfig.default()

    fam_events = generate_mode_f_familiarisation(config, seed=seed)
    pipeline = _pitched_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
    sid = f"mode_f_familiarisation_{seed:04d}"
    sidecar = pipeline.render_stimulus(fam_events, stimulus_id=sid, output_dir=output,
                                       metadata=config.to_metadata(), seed=seed)
    _report(sid, sidecar, "phase=familiarisation")

    for ei in range(len(config.probe_entropies)):
        probe_seed = seed + ei + 100
        probe_events = generate_mode_f_probe(config, entropy_index=ei, seed=probe_seed)
        sid = f"mode_f_probe_e{ei}_{probe_seed:04d}"
        sidecar = pipeline.render_stimulus(probe_events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=probe_seed)
        _report(sid, sidecar, f"entropy_index={ei}")


def render_mode_g(args: argparse.Namespace) -> None:
    output = Path(args.output)
    edos = [5, 7, 12, 19, 24]
    for edo in edos:
        seed = args.seed + edo
        config = ModeGConfig.default(octave_division=edo)
        events = generate_mode_g_events(config, seed=seed)
        pipeline = _pitched_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
        sid = f"mode_g_{edo}edo_{seed:04d}"
        sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=seed)
        violations = sum(1 for ev in sidecar["events"] if ev.get("tags", {}).get("violation"))
        _report(sid, sidecar, f"edo={edo}, violations={violations}")


def render_mode_h(args: argparse.Namespace) -> None:
    output = Path(args.output)
    for condition in MODEH_CONDITIONS:
        seed = args.seed
        config = ModeHConfig.default(condition=condition)
        events = generate_mode_h_events(config, seed=seed)
        pipeline = _pitched_pipeline(seed, args.sample_rate, args.target_lufs, args.peak_db)
        sid = f"mode_h_{condition}_{seed:04d}"
        sidecar = pipeline.render_stimulus(events, stimulus_id=sid, output_dir=output,
                                           metadata=config.to_metadata(), seed=seed)
        _report(sid, sidecar, f"condition={condition}")


def render_mode_i(args: argparse.Namespace) -> None:
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    seed = args.seed
    config = ModeIConfig.default(parameter=args.parameter)
    spec = generate_mode_i_trial_spec(config, seed=seed)
    spec_path = output / f"mode_i_trial_{seed:04d}.json"
    spec_path.write_text(json.dumps(spec, indent=2, sort_keys=True), encoding="utf-8")
    print(f"mode_i_trial_{seed:04d}: parameter={config.controlled_parameter}, "
          f"initial={spec['initial_value']:.3f}, events={len(spec['initial_events'])}")


def dry_run(args: argparse.Namespace) -> None:
    runner = DryRunExperimentRunner()
    for marker in runner.trial_schedule(args.sidecar):
        print(f"{marker.onset_s:8.3f}s  code={marker.code:3d}  {marker.label:18s}  {marker.event_id}")


# -------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="synthesiser")
    sub = parser.add_subparsers(dest="command", required=True)

    common_kw = {
        "--seed": {"type": int, "default": 42},
        "--sample-rate": {"type": int, "default": 48_000},
        "--target-lufs": {"type": float, "default": -23.0},
        "--peak-db": {"type": float, "default": -1.0},
    }

    def add_common(p: argparse.ArgumentParser, output_default: str) -> None:
        p.add_argument("--output", default=output_default)
        for flag, kw in common_kw.items():
            p.add_argument(flag, **kw)

    # Mode A
    p = sub.add_parser("render-mode-a", help="Render Mode A repetition-precision sweep (5 sigma levels)")
    add_common(p, "stimuli/mode_a")
    p.set_defaults(func=render_mode_a)

    # Mode B
    p = sub.add_parser("render-mode-b", help="Render Mode B affective vs phonemic conditions")
    add_common(p, "stimuli/mode_b")
    p.set_defaults(func=render_mode_b)

    # Mode C
    p = sub.add_parser("render-mode-c", help="Render Mode C on/pre/off-beat probe stimuli")
    add_common(p, "stimuli/mode_c")
    p.add_argument("--trials", type=int, default=3)
    p.add_argument("--placement", choices=["cycle", "on_beat", "pre_beat", "off_beat"], default="cycle")
    p.set_defaults(func=render_mode_c)

    # Mode D
    p = sub.add_parser("render-mode-d", help="Render Mode D hierarchical violations")
    add_common(p, "stimuli/mode_d")
    p.set_defaults(func=render_mode_d)

    # Mode E
    p = sub.add_parser("render-mode-e", help="Render Mode E vocal self-simulation listening block")
    add_common(p, "stimuli/mode_e")
    p.set_defaults(func=render_mode_e)

    # Mode F
    p = sub.add_parser("render-mode-f", help="Render Mode F familiarisation + probe stimuli")
    add_common(p, "stimuli/mode_f")
    p.set_defaults(func=render_mode_f)

    # Mode G
    p = sub.add_parser("render-mode-g", help="Render Mode G octave division & scale learning")
    add_common(p, "stimuli/mode_g")
    p.set_defaults(func=render_mode_g)

    # Mode H
    p = sub.add_parser("render-mode-h", help="Render Mode H hierarchical-repetition conditions")
    add_common(p, "stimuli/mode_h")
    p.set_defaults(func=render_mode_h)

    # Mode I
    p = sub.add_parser("render-mode-i", help="Generate Mode I trial spec (JSON, no audio)")
    p.add_argument("--output", default="stimuli/mode_i")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--parameter", default="motif_entropy")
    p.set_defaults(func=render_mode_i)

    # Dry-run
    p = sub.add_parser("dry-run", help="Print marker schedule from a JSON sidecar")
    p.add_argument("sidecar")
    p.set_defaults(func=dry_run)

    # Export web study/explore data to tidy CSVs
    p = sub.add_parser("export", help="Export web data (explore events, ratings, stimuli, study trials, presets) to CSV")
    p.add_argument("--data-dir", default="web/data", help="Directory holding the JSONL/JSON data files")
    p.add_argument("--out", default="exports", help="Output directory for CSV files")
    p.set_defaults(func=export_data)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
