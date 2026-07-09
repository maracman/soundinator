# Effects module contract (v1) — layer-level effects stage

Effects sit **between BODY and SPACE** in the per-layer chain:
excitor → resonator → body → **effects** → space. Every layer (and the base
voice) owns an ordered `effectsChain` array; the host builds one WebAudio
subgraph per chain and wraps **each effect** in its own dry/wet crossfade and
enable bypass. Modules never implement their own master mix or bypass.

## File layout

One ES module per effect at `web/static/effects/<id>.js`, default-exporting a
single object. No other files; CSS is injected by the module itself (see UI).
Modules are imported by `web/static/effects/index.js` (host-owned — do not
edit it from an effect module task).

## Module shape

```js
export default {
  id: "tape-echo",                  // kebab-case, matches filename
  name: "Tape Echo",                // display name
  category: "Delay & Echo",         // one of the categories below
  description: "Warm tape-loop echoes with wow, motor drift and runaway feedback.",
      // ONE line, ≤90 chars — shown ellipsized in the browser row, full on hover
  defaults: { time: 0.36, feedback: 0.45, tone: 0.6, wow: 0.3 },
  params: {                         // schema for every key in defaults
    time:     { label: "Time",     min: 0.05, max: 1.2,  step: 0.005, unit: "s"  },
    feedback: { label: "Repeats",  min: 0,    max: 1.08, step: 0.01,  unit: ""   },
    // curve: "log" allowed for frequency-ish params (host only uses min/max/step for validation)
  },
  presets: [                        // 3–6 musically distinct, usable presets
    { name: "Slapback", params: { time: 0.11, feedback: 0.12, tone: 0.7, wow: 0.15 } },
  ],
  defaultWet: 0.4,                  // optional. The host crossfades dry(1-wet)/wet(wet).
      // Shaping effects (EQ, drive, chorus, phaser…) process the whole signal → omit (1).
      // Time-based effects (echo, reverb) must output the WET-ONLY signal (no dry
      // pass-through inside the module!) and declare a musical defaultWet (~0.3–0.5).

  // DSP — must work in BOTH live AudioContext and OfflineAudioContext.
  build(ctx) {
    // ... create nodes ...
    return {
      input,                        // AudioNode (mono signal arrives here)
      output,                       // AudioNode (mono-compatible out)
      update(params) { ... },       // apply full params object, CLICK-FREE
                                    // (setTargetAtTime ~0.02s; called at UI drag rate)
      dispose() { ... },            // stop oscillators/LFOs, disconnect everything
    };
  },

  // UI — full skeuomorphic / plugin-style face. Vanilla DOM only.
  ui(container, host) {
    // host.params        → current params object (read fresh each time, don't cache stale)
    // host.setParam(k,v) → persist + live-update DSP (host throttles engine work)
    // host.analyser      → AnalyserNode tapping this effect's WET output (may be null
    //                      in producer contexts) — use it for real signal-driven visuals
    // host.expanded      → boolean; true when shown as a large overlay
    // Return a dispose() function that removes listeners/rAF loops.
  },
};
```

## Categories (fixed list — pick one)

- `"Filter & EQ"`
- `"Drive & Dirt"`
- `"Modulation"`
- `"Delay & Echo"`
- `"Character"`

## DSP rules

- **Mono processing.** The chain runs BEFORE the binaural space stage, so the
  signal is positionally mono. Do not pan, do not use stereo width tricks,
  do not use ChannelSplitter for L/R effects. (Internal multi-tap/parallel
  paths are fine — just sum to one channel's worth of signal.)
- **Native nodes only**: Gain, BiquadFilter, Delay, WaveShaper, Convolver,
  DynamicsCompressor, Oscillator (as LFO/carrier), ConstantSource,
  AudioBufferSource (procedural buffers). **No AudioWorklet, no
  ScriptProcessor** (they break the offline mixdown path).
- **Offline-safe**: `build(ctx)` may be called with an OfflineAudioContext.
  Never reference `ctx.destination`, never resume/suspend, never use
  `Date.now()`/`performance.now()` inside DSP. Start LFO oscillators at
  `ctx.currentTime`.
- **Procedural assets only**: impulse responses, noise, wavetables must be
  generated in code (Math.random for noise is acceptable). No fetch, no
  external files.
- **Click-free updates**: every `update()` uses `setTargetAtTime`/ramps —
  it is called continuously while a knob is dragged.
- **Unity-ish gain staging**: roughly unity loudness at defaults; drives
  and folders must compensate output level so toggling the effect doesn't
  double the volume. Feedback params must be internally limited so the
  chain can never blow up unbounded (soft-clip the loop if you allow >1).
- **Sensible ranges**: research the classic hardware/plugin this is modelled
  on and use ranges that stay musical across the whole sweep. Every extreme
  of every knob should still be a *usable* sound.

## UI rules

- **Own design language, deliberately NOT the app shell.** The host app is
  flat FabFilter-style monochrome; effects should instead feel like familiar
  plugins/hardware — brushed panels, cream/bakelite knobs, jewel lamps, VU
  needles, tape reels, stomp-box enamel… whatever suits the specific effect's
  heritage. Commit to one coherent identity per effect.
- **Self-contained CSS**: inject one `<style data-fx="<id>">` element into
  `document.head` (guard against double-injection). Prefix EVERY class with
  `fx-<id>-`. Never style global tags. The app's CSS variables may be ignored
  entirely — bring your own palette.
- **Dynamically resizable**: the root must fill `container` (100% width and
  height, `container` is a block with definite size), lay out with
  flex/grid, and stay usable from ~340×260 up to ~1400×900 (the expanded
  overlay). Use a `ResizeObserver` to keep canvases crisp
  (`devicePixelRatio`-aware). When `host.expanded` is true you may reveal
  extra detail (bigger visualiser, preset row, fine readouts).
- **Visual feedback is mandatory**: the panel must SHOW what the processing
  does — e.g. EQ curve that redraws with the knobs, tape heads whose spacing
  follows delay time, LFO lamp blinking at rate, fold-transfer curve, VU
  gain-reduction needle. Use `host.analyser` for signal-reactive elements
  when it is non-null; parameter-driven animation otherwise.
- **Interaction**: knobs/sliders respond to vertical drag AND double-click
  to reset to default; show the precise value + unit while dragging
  (tooltip or inline readout). Keyboard focusable is a bonus, not required.
- **No rAF leaks**: run animation loops only while the element is connected;
  stop them in the returned dispose().

## Host-side data (for reference — modules don't touch this)

```js
// per layer, inside the sound-half params:
effectsChain: [
  { uid: "fx-8f3a", type: "tape-echo", enabled: true, wet: 0.5, params: { ...defaults } },
]
```

`wet` crossfade and `enabled` bypass are host wrappers around your
input/output pair. `stageEffectsOn:false` bypasses the whole stack.
