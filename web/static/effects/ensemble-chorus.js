// Ensemble Chorus — bucket-brigade string-machine ensemble, per the effects
// contract (docs/EFFECTS_CONTRACT.md): mono DSP, offline-safe, self-styled
// skeuomorphic face with parameter-driven visual feedback.
//
// Topology after the Roland Juno-60 chorus / Solina String Ensemble: two or
// three parallel short BBD delay lines (~5–8 ms) each swept by its own LFO.
// True 120° phase offsets aren't settable on OscillatorNode, so decorrelation
// comes the ensemble way: slightly detuned LFO rates plus one inverted-
// polarity sweep — phases drift apart and stay apart, exactly the animated
// "wall of strings" shimmer of the originals. Wet paths sum through a
// BBD-darkening lowpass; module outputs WET ONLY (host blends, defaultWet .5).

const CSS = `
.fx-ensemble-chorus-root{width:100%;height:100%;display:flex;box-sizing:border-box;
  background:#2a1a10;border-radius:10px;overflow:hidden;position:relative;
  font-family:Futura,'Trebuchet MS','Helvetica Neue',sans-serif;color:#2b2b2e;
  box-shadow:inset 0 1px 0 #ffffff22,0 2px 8px #0008;}
.fx-ensemble-chorus-root *{box-sizing:border-box;}
.fx-ensemble-chorus-cheek{flex:0 0 clamp(10px,3.5%,24px);
  background:linear-gradient(90deg,#5a3a1e 0%,#7a5228 30%,#8f6132 50%,#6b4522 80%,#472a12 100%);
  box-shadow:inset 0 0 6px #0007;
  background-blend-mode:multiply;}
.fx-ensemble-chorus-cheek+.fx-ensemble-chorus-panel+.fx-ensemble-chorus-cheek{
  background:linear-gradient(270deg,#5a3a1e 0%,#7a5228 30%,#8f6132 50%,#6b4522 80%,#472a12 100%);}
.fx-ensemble-chorus-panel{flex:1;min-width:0;display:flex;flex-direction:column;
  background:
    repeating-linear-gradient(90deg,#c9ccd1 0px,#d6d9de 1px,#c9ccd1 2px),
    linear-gradient(180deg,#d8dbe0,#b9bcc2);
  background-blend-mode:overlay;
  border-left:2px solid #17100933;border-right:2px solid #17100933;}
.fx-ensemble-chorus-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
  padding:9px 14px 5px;border-bottom:1px solid #9a9da3;
  background:linear-gradient(180deg,#e4e6ea,#c9ccd1);}
.fx-ensemble-chorus-logo{font-size:16px;font-weight:700;letter-spacing:.22em;
  color:#1e1e22;text-shadow:0 1px 0 #ffffffaa;font-style:italic;}
.fx-ensemble-chorus-sub{font-size:8.5px;letter-spacing:.28em;text-transform:uppercase;color:#55585e;}
.fx-ensemble-chorus-stripe{margin-left:auto;align-self:center;width:64px;height:10px;flex:0 0 auto;
  background:linear-gradient(180deg,#c8511e 0 33%,#e0921e 33% 66%,#7c6a30 66% 100%);
  border:1px solid #77500f;border-radius:2px;}
.fx-ensemble-chorus-display{margin:8px 14px 4px;flex:1 1 60px;min-height:52px;position:relative;
  background:radial-gradient(120% 140% at 50% 0%,#241d12 0%,#120d07 70%);
  border-radius:5px;border:2px solid #6d7076;
  box-shadow:inset 0 3px 10px #000d,0 1px 0 #ffffff66;}
.fx-ensemble-chorus-display canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.fx-ensemble-chorus-controls{flex:0 0 auto;display:flex;align-items:center;justify-content:space-evenly;
  gap:6px;padding:8px 10px 12px;flex-wrap:wrap;}
.fx-ensemble-chorus-cell{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:62px;}
.fx-ensemble-chorus-knob{width:48px;height:48px;border-radius:50%;cursor:ns-resize;position:relative;
  background:
    radial-gradient(circle at 34% 28%,#f4f5f7,#c2c5ca 45%,#84878d 75%,#5d6066 100%);
  border:2px solid #4c4f55;box-shadow:0 3px 6px #0008,inset 0 1px 1px #fff9;}
.fx-ensemble-chorus-knob::before{content:"";position:absolute;inset:14px;border-radius:50%;
  background:radial-gradient(circle at 38% 32%,#3c3f45,#17181b 75%);box-shadow:inset 0 1px 2px #0009;}
.fx-ensemble-chorus-knob::after{content:"";position:absolute;left:50%;top:3px;width:3px;height:15px;
  margin-left:-1.5px;border-radius:2px;background:#c8511e;transform-origin:1.5px 21px;
  transform:rotate(var(--fx-rot,0deg));box-shadow:0 0 2px #0007;}
.fx-ensemble-chorus-label{font-size:8.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#3a3d43;}
.fx-ensemble-chorus-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#241d12;
  background:#e9ebee;border:1px solid #8f9298;border-radius:3px;padding:0 5px;min-width:54px;text-align:center;}
.fx-ensemble-chorus-modes{display:flex;flex-direction:column;gap:6px;justify-content:center;}
.fx-ensemble-chorus-modelbl{font-size:8.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;
  color:#3a3d43;text-align:center;}
.fx-ensemble-chorus-btn{min-width:86px;padding:7px 12px;border-radius:4px;cursor:pointer;user-select:none;
  font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:#6e5636;text-align:center;background:linear-gradient(180deg,#3b2f1c,#241c10);
  border:2px solid #101010;border-top-color:#555;
  box-shadow:0 2px 3px #0009,inset 0 1px 0 #ffffff22;text-shadow:none;transition:color .12s;}
.fx-ensemble-chorus-btn[data-on]{color:#fff3d8;
  background:linear-gradient(180deg,#e8921e,#b35a12 60%,#8a3f0c);
  border-top-color:#ffcf8a;text-shadow:0 0 6px #ffd27acc;
  box-shadow:0 0 12px #e8921e88,inset 0 1px 0 #ffe9bf88,0 2px 3px #0009;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="ensemble-chorus"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "ensemble-chorus";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// Three BBD lines: staggered base delays inside the classic 4–8 ms window,
// LFO rate ratios that never phase-lock, one inverted sweep polarity.
const LINES = [
  { base: 0.0052, ratio: 1.0,   pol:  1 },
  { base: 0.0064, ratio: 0.937, pol: -1 },
  { base: 0.0077, ratio: 1.069, pol:  1 },
];
const MOD_MAX = 0.0024; // ±2.4 ms sweep at depth 1 — deep but never seasick-broken
const warmthHz = (w) => 11000 * Math.pow(2300 / 11000, w); // 11 kHz clear → 2.3 kHz BBD murk

export default {
  id: "ensemble-chorus",
  name: "Ensemble Chorus",
  category: "Modulation",
  description: "Triple-BBD string-machine chorus — swirling detuned voices under warm bucket-brigade haze.",
  defaults: { rate: 0.55, depth: 0.65, voices: 3, warmth: 0.5 },
  params: {
    rate:   { label: "Rate",   min: 0.08, max: 6.5, step: 0.01, unit: "Hz" },
    depth:  { label: "Depth",  min: 0,    max: 1,   step: 0.01, unit: ""   },
    voices: { label: "Voices", min: 2,    max: 3,   step: 1,    unit: ""   },
    warmth: { label: "Warmth", min: 0,    max: 1,   step: 0.01, unit: ""   },
  },
  presets: [
    { name: "Mode I",        params: { rate: 0.5,  depth: 0.55, voices: 2, warmth: 0.55 } },
    { name: "Mode II",       params: { rate: 0.85, depth: 0.8,  voices: 2, warmth: 0.6  } },
    { name: "String Machine",params: { rate: 0.62, depth: 0.72, voices: 3, warmth: 0.75 } },
    { name: "Glass Ensemble",params: { rate: 1.6,  depth: 0.32, voices: 3, warmth: 0.12 } },
    { name: "Seasick Tape",  params: { rate: 4.2,  depth: 0.9,  voices: 3, warmth: 0.45 } },
  ],
  defaultWet: 0.5, // classic half-dry BBD blend — module outputs WET ONLY

  build(ctx) {
    const input = ctx.createGain();
    const wetSum = ctx.createGain();
    const bbd = ctx.createBiquadFilter();
    const output = ctx.createGain();
    bbd.type = "lowpass";
    bbd.frequency.value = warmthHz(0.5);
    bbd.Q.value = 0.4;
    wetSum.connect(bbd);
    bbd.connect(output);

    const lines = LINES.map((L) => {
      const delay = ctx.createDelay(0.03);
      delay.delayTime.value = L.base;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.55 * L.ratio;
      const sweep = ctx.createGain();   // LFO → delayTime, scaled ±depth
      sweep.gain.value = 0;
      const tap = ctx.createGain();     // per-voice mix (also voice on/off)
      tap.gain.value = 0;
      lfo.connect(sweep);
      sweep.connect(delay.delayTime);
      input.connect(delay);
      delay.connect(tap);
      tap.connect(wetSum);
      lfo.start(ctx.currentTime);
      return { L, delay, lfo, sweep, tap };
    });

    return {
      input,
      output,
      update(p) {
        const t = ctx.currentTime;
        const n = Math.round(p.voices);
        const mod = p.depth * MOD_MAX;
        lines.forEach((v, i) => {
          const on = i < n;
          v.lfo.frequency.setTargetAtTime(Math.max(0.01, p.rate * v.L.ratio), t, 0.02);
          v.sweep.gain.setTargetAtTime(on ? mod * v.L.pol : 0, t, 0.02);
          v.delay.delayTime.setTargetAtTime(v.L.base, t, 0.02);
          // 1/n sum keeps the ensemble at unity-ish loudness for 2 or 3 voices
          v.tap.gain.setTargetAtTime(on ? 1 / n : 0, t, 0.045);
        });
        bbd.frequency.setTargetAtTime(warmthHz(p.warmth), t, 0.02);
      },
      dispose() {
        for (const v of lines) {
          try { v.lfo.stop(); } catch {}
          for (const n of [v.lfo, v.sweep, v.delay, v.tap]) { try { n.disconnect(); } catch {} }
        }
        for (const n of [input, wetSum, bbd, output]) { try { n.disconnect(); } catch {} }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const KNOBS = ["rate", "depth", "warmth"];
    const root = document.createElement("div");
    root.className = "fx-ensemble-chorus-root";
    root.innerHTML = `
      <div class="fx-ensemble-chorus-cheek"></div>
      <div class="fx-ensemble-chorus-panel">
        <div class="fx-ensemble-chorus-head">
          <span class="fx-ensemble-chorus-logo">CAVATINA</span>
          <span class="fx-ensemble-chorus-sub">ensemble chorus · model S-303</span>
          <span class="fx-ensemble-chorus-stripe"></span>
        </div>
        <div class="fx-ensemble-chorus-display"><canvas></canvas></div>
        <div class="fx-ensemble-chorus-controls">
          ${KNOBS.map((k) => `
            <div class="fx-ensemble-chorus-cell">
              <div class="fx-ensemble-chorus-knob" data-knob="${k}"></div>
              <span class="fx-ensemble-chorus-label">${P[k].label}</span>
              <span class="fx-ensemble-chorus-val" data-val="${k}"></span>
            </div>`).join("")}
          <div class="fx-ensemble-chorus-modes">
            <span class="fx-ensemble-chorus-modelbl">Ensemble</span>
            <div class="fx-ensemble-chorus-btn" data-mode="2">Mode II</div>
            <div class="fx-ensemble-chorus-btn" data-mode="3">Mode III</div>
          </div>
        </div>
      </div>
      <div class="fx-ensemble-chorus-cheek"></div>`;
    container.appendChild(root);

    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");
    const modeBtns = [...root.querySelectorAll("[data-mode]")];

    const fmt = (k, v) => k === "rate" ? `${v.toFixed(2)} Hz` : `${Math.round(v * 100)}%`;
    const rotFor = (k, v) => -135 + 270 * (v - P[k].min) / (P[k].max - P[k].min);
    const paint = () => {
      const p = host.params;
      for (const k of KNOBS) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rotFor(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
      const n = Math.round(p.voices);
      for (const b of modeBtns) {
        if (+b.dataset.mode === n) b.setAttribute("data-on", "");
        else b.removeAttribute("data-on");
      }
    };
    paint();

    // knobs: vertical drag, double-click resets to default
    for (const k of KNOBS) {
      const el = root.querySelector(`[data-knob="${k}"]`);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, startV = host.params[k];
        const range = P[k].max - P[k].min;
        const move = (ev) => {
          let v = startV + (startY - ev.clientY) / 140 * range;
          v = Math.min(P[k].max, Math.max(P[k].min, Math.round(v / P[k].step) * P[k].step));
          host.setParam(k, v);
          paint();
        };
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      });
      el.addEventListener("dblclick", () => { host.setParam(k, this.defaults[k]); paint(); });
    }

    // illuminated mode buttons: II / III voice select
    for (const b of modeBtns) {
      b.addEventListener("click", () => { host.setParam("voices", +b.dataset.mode); paint(); });
      b.addEventListener("dblclick", () => { host.setParam("voices", this.defaults.voices); paint(); });
    }

    // display: three orbiting BBD sweep dots on lissajous traces — speed
    // follows rate (with each line's detune ratio), excursion follows depth.
    const VOICE_HUES = ["#ffcf7a", "#ff8a3c", "#e8b34a"];
    const phases = [0, 2.094, 4.189]; // start spread ~120° apart, then drift
    let last = performance.now();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
      canvas.width = Math.max(1, r.width * d);
      canvas.height = Math.max(1, r.height * d);
    });
    ro.observe(canvas);

    const draw = () => {
      if (!root.isConnected) return;
      const p = host.params;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const n = Math.round(p.voices);
      const w = canvas.width, h = canvas.height;
      cx.clearRect(0, 0, w, h);
      const cxm = w / 2;
      const exMax = w * 0.42, ex = Math.max(w * 0.02, exMax * p.depth);
      for (let i = 0; i < 3; i++) {
        phases[i] += dt * p.rate * LINES[i].ratio * 2 * Math.PI * LINES[i].pol;
        const on = i < n;
        const cy = h * (0.25 + 0.25 * i);
        const ey = h * 0.09;
        // trace: full-cycle lissajous path, faint
        cx.strokeStyle = VOICE_HUES[i];
        cx.globalAlpha = on ? 0.28 : 0.07;
        cx.lineWidth = Math.max(1, h / 90);
        cx.beginPath();
        for (let s = 0; s <= 64; s++) {
          const ph = (s / 64) * 2 * Math.PI;
          const x = cxm + ex * Math.sin(ph);
          const y = cy + ey * Math.sin(2 * ph + i * 1.3);
          s ? cx.lineTo(x, y) : cx.moveTo(x, y);
        }
        cx.stroke();
        // the orbiting BBD dot
        const dx = cxm + ex * Math.sin(phases[i]);
        const dy = cy + ey * Math.sin(2 * phases[i] + i * 1.3);
        cx.globalAlpha = on ? 1 : 0.14;
        cx.fillStyle = VOICE_HUES[i];
        cx.shadowColor = VOICE_HUES[i];
        cx.shadowBlur = on ? Math.max(4, h / 14) : 0;
        cx.beginPath();
        cx.arc(dx, dy, Math.max(2, h / 26), 0, 7);
        cx.fill();
        cx.shadowBlur = 0;
      }
      cx.globalAlpha = 1;
      // active mode lamp breathes with the master LFO phase
      const glow = 0.55 + 0.45 * Math.sin(phases[0]);
      const active = modeBtns.find((b) => b.hasAttribute("data-on"));
      if (active) {
        active.style.boxShadow =
          `0 0 ${8 + 10 * glow}px rgba(232,146,30,${0.35 + 0.4 * glow}), inset 0 1px 0 #ffe9bf88, 0 2px 3px #0009`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
