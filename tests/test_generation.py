from synthesiser.jitter import JitterConfig, JitterStage
from synthesiser.modes import ModeCConfig, generate_mode_c_events
from synthesiser.probe import ProbeInjector, StartleProbeConfig
from synthesiser.sequencer import L1BeatConfig, L1BeatSequencer
from synthesiser.pitch import PitchSystem


def test_l1_sequence_count_and_timing() -> None:
    events = L1BeatSequencer(L1BeatConfig(tempo_bpm=120, beats=4)).generate(PitchSystem())
    assert len(events) == 4
    assert [event.onset_s for event in events] == [0.0, 0.5, 1.0, 1.5]


def test_probe_injection_adds_probe_with_code() -> None:
    beat_events = L1BeatSequencer(L1BeatConfig(beats=4)).generate(PitchSystem())
    events = ProbeInjector(StartleProbeConfig(placement="off_beat", probe_count=1)).inject(beat_events, seed=1)
    probes = [event for event in events if event["kind"] == "probe"]
    assert len(probes) == 1
    assert probes[0]["tags"]["trigger_code"] == 23


def test_jitter_reproducible() -> None:
    events = generate_mode_c_events(ModeCConfig.default(), seed=123)
    jitter = JitterStage(JitterConfig(pitch_cents=5, timing_ms=2, intensity_db=1))
    first = jitter.apply(events, seed=10)
    second = jitter.apply(events, seed=10)
    assert first == second
