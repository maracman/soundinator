// Wavefolder — west-coast sine folding in the Buchla 259 / Serge wave
// multiplier tradition. Effects-contract module (docs/EFFECTS_CONTRACT.md):
// mono, offline-safe, click-free updates, self-styled modular-panel face
// with a live oscilloscope of the actual transfer curve at work.
//
// DSP: input → drive gain (fold amount) → [ + bias ConstantSource
// + slow LFO wobble ] → WaveShaper with a FIXED high-resolution
// sin(K·π/2·x) multi-fold curve (drive slides the signal deeper into the
// curve, so fold sweeps never regenerate the curve → zipper/click free)
// → DC-blocking highpass (bias creates DC) → colour lowpass → compensated
// output gain.

const FOLDS = 16;          // folds across the shaper's full ±1 domain
const CURVE_N = 16385;     // resolution: ~1k samples per fold
const F_MIN = 0.6;         // effective folds at fold=0 (near-linear, clean-ish)

const CSS = `
.fx-wavefolder-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:linear-gradient(180deg,#23262a 0%,#181a1d 60%,#101214 100%);
  border-radius:8px;border:1px solid #000;position:relative;overflow:hidden;
  font-family:'Helvetica Neue',Arial,sans-serif;color:#c8ccd0;
  box-shadow:inset 0 1px 0 #ffffff14,inset 0 -1px 0 #0008;}
.fx-wavefolder-root *{box-sizing:border-box;}
.fx-wavefolder-screw{position:absolute;width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#b9bfc4,#5c6166 60%,#2a2d30);
  box-shadow:inset 0 1px 1px #fff5,0 1px 1px #000a;}
.fx-wavefolder-screw::after{content:"";position:absolute;left:1px;right:1px;top:50%;height:1px;
  margin-top:-.5px;background:#1c1e20;transform:rotate(37deg);}
.fx-wavefolder-head{display:flex;align-items:baseline;gap:10px;padding:9px 22px 5px;
  background:linear-gradient(180deg,#9aa0a6 0%,#7d838a 45%,#666c73 100%);
  border-bottom:2px solid #0c0d0e;color:#17191b;flex:0 0 auto;}
.fx-wavefolder-logo{font-size:14px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  text-shadow:0 1px 0 #ffffff55;}
.fx-wavefolder-model{font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#2c3033;}
.fx-wavefolder-badge{margin-left:auto;font-size:8px;letter-spacing:.2em;text-transform:uppercase;
  border:1px solid #2c3033;border-radius:2px;padding:1px 6px;color:#2c3033;}
.fx-wavefolder-scope{margin:8px 14px 4px;flex:1 1 40%;min-height:64px;position:relative;
  background:#050d06;border-radius:4px;border:2px solid #3a3f44;
  box-shadow:inset 0 0 18px #000e,0 1px 0 #ffffff10;}
.fx-wavefolder-scope canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.fx-wavefolder-knobs{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:space-evenly;
  padding:8px 8px 10px;min-height:0;}
.fx-wavefolder-cell{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:60px;}
.fx-wavefolder-knob{width:46px;height:46px;border-radius:50%;cursor:ns-resize;position:relative;
  background:repeating-conic-gradient(#8e959b 0deg 5deg,#3f4449 5deg 10deg);
  box-shadow:0 3px 7px #000c,inset 0 1px 1px #fff4;}
.fx-wavefolder-knob::before{content:"";position:absolute;inset:6px;border-radius:50%;
  background:radial-gradient(circle at 34% 28%,#c7ccd1,#84898f 55%,#4c5156);
  box-shadow:inset 0 -2px 3px #0007,inset 0 1px 1px #fff8;}
.fx-wavefolder-knob::after{content:"";position:absolute;left:50%;top:8px;width:3px;height:14px;
  margin-left:-1.5px;border-radius:1.5px;background:#101214;
  transform-origin:1.5px 15px;transform:rotate(var(--fx-rot,0deg));}
.fx-wavefolder-jack{width:10px;height:10px;border-radius:50%;border:2px solid #0a0b0c;
  background:radial-gradient(circle at 35% 30%,#fff7,var(--fx-jack,#d33) 45%,#0007 95%);
  box-shadow:0 0 0 2px #2c3033,0 1px 2px #000a;}
.fx-wavefolder-label{font-size:8px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;
  color:#aab0b6;}
.fx-wavefolder-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#7dffa0;
  background:#0a1a0d;border:1px solid #2f3a31;border-radius:3px;padding:0 5px;
  min-width:56px;text-align:center;text-shadow:0 0 4px #4dff7a55;}
.fx-wavefolder-presets{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;
  padding:0 12px 10px;flex:0 0 auto;}
.fx-wavefolder-preset{font-size:9px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;
  color:#c8ccd0;background:linear-gradient(180deg,#3a3f44,#25282c);border:1px solid #0c0d0e;
  border-radius:3px;padding:3px 9px;box-shadow:0 1px 0 #ffffff18 inset,0 1px 2px #0009;}
.fx-wavefolder-preset:hover{color:#7dffa0;border-color:#2f3a31;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="wavefolder"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "wavefolder";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// The one fixed transfer curve: sin folding across FOLDS folds.
function makeFoldCurve() {
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const x = (i / (CURVE_N - 1)) * 2 - 1;
    c[i] = Math.sin(FOLDS * Math.PI * 0.5 * x);
  }
  return c;
}

// Shared param → DSP mapping (also used by the scope so it draws the truth).
function driveFor(fold) { return (F_MIN + fold) / FOLDS; }            // shaper pre-gain
function biasFor(p) { return p.symmetry * 0.35 * driveFor(p.fold); }  // ConstantSource offset
function wobbleDepth(p) { return p.animate * 0.1 * driveFor(p.fold); }
function wobbleRate(p) { return 0.25 + 1.25 * p.animate; }            // Hz
function compFor(fold) {
  // Peak of sin(F·π/2·s) is sin(F·π/2) below one full fold, 1 above; add a
  // gentle loudness trim as harmonics stack so the sweep stays unity-ish.
  const F = F_MIN + fold;
  const peak = F >= 1 ? 1 : Math.sin(F * Math.PI * 0.5);
  return 0.9 / peak / (1 + 0.08 * Math.max(0, F - 1));
}
function foldEval(x) { // exact same math as the WaveShaper curve
  const c = Math.max(-1, Math.min(1, x));
  return Math.sin(FOLDS * Math.PI * 0.5 * c);
}

export default {
  id: "wavefolder",
  name: "Wavefolder",
  category: "Drive & Dirt",
  description: "West-coast sine folding — harmonics bloom as the wave wraps back on itself, Buchla-style.",
  defaults: { fold: 2.5, symmetry: 0.15, colour: 6500, animate: 0 },
  params: {
    fold:     { label: "Fold",     min: 0,    max: 10,    step: 0.05, unit: "×"  },
    symmetry: { label: "Symmetry", min: -1,   max: 1,     step: 0.01, unit: ""   },
    colour:   { label: "Colour",   min: 500,  max: 16000, step: 10,   unit: "Hz", curve: "log" },
    animate:  { label: "Animate",  min: 0,    max: 1,     step: 0.01, unit: ""   },
  },
  presets: [
    { name: "Gentle Bloom",    params: { fold: 1.2, symmetry: 0.1,  colour: 8000,  animate: 0.1  } },
    { name: "Brass Blossom",   params: { fold: 3.5, symmetry: 0.3,  colour: 5500,  animate: 0    } },
    { name: "Rippling Chrome", params: { fold: 4.5, symmetry: 0.5,  colour: 12000, animate: 0.65 } },
    { name: "Full Tine Fold",  params: { fold: 6.5, symmetry: 0,    colour: 9000,  animate: 0.2  } },
    { name: "Buried Alloy",    params: { fold: 8.5, symmetry: -0.4, colour: 2200,  animate: 0.3  } },
  ],

  build(ctx) {
    const input = ctx.createGain();
    const drive = ctx.createGain();          // fold amount = how deep into the curve
    const folder = ctx.createWaveShaper();
    const bias = ctx.createConstantSource(); // symmetry offset, summed pre-folder
    const lfo = ctx.createOscillator();      // slow bias wobble ("animate")
    const lfoGain = ctx.createGain();
    const dcBlock = ctx.createBiquadFilter();// bias → DC at folder output; strip it
    const lp = ctx.createBiquadFilter();     // "colour" — tames fold fizz
    const comp = ctx.createGain();           // fold-tracking level compensation

    folder.curve = makeFoldCurve();
    folder.oversample = "4x";                // folding is aliasing-prone
    drive.gain.value = driveFor(2.5);
    bias.offset.value = biasFor({ fold: 2.5, symmetry: 0.15 });
    lfo.type = "sine";
    lfo.frequency.value = wobbleRate({ animate: 0 });
    lfoGain.gain.value = 0;
    dcBlock.type = "highpass";
    dcBlock.frequency.value = 16;
    lp.type = "lowpass";
    lp.frequency.value = 6500;
    lp.Q.value = 0.5;
    comp.gain.value = compFor(2.5);

    input.connect(drive);
    drive.connect(folder);
    bias.connect(folder);                    // sums with the driven signal at the shaper input
    lfo.connect(lfoGain);
    lfoGain.connect(folder);
    folder.connect(dcBlock);
    dcBlock.connect(lp);
    lp.connect(comp);
    bias.start(ctx.currentTime);
    lfo.start(ctx.currentTime);

    return {
      input,
      output: comp,
      update(p) {
        // Curve is never regenerated — every param rides a smoothed AudioParam.
        const t = ctx.currentTime;
        drive.gain.setTargetAtTime(driveFor(p.fold), t, 0.02);
        bias.offset.setTargetAtTime(biasFor(p), t, 0.02);
        lfoGain.gain.setTargetAtTime(wobbleDepth(p), t, 0.02);
        lfo.frequency.setTargetAtTime(wobbleRate(p), t, 0.02);
        lp.frequency.setTargetAtTime(p.colour, t, 0.02);
        comp.gain.setTargetAtTime(compFor(p.fold), t, 0.02);
      },
      dispose() {
        try { bias.stop(); } catch {}
        try { lfo.stop(); } catch {}
        for (const n of [input, drive, folder, bias, lfo, lfoGain, dcBlock, lp, comp]) {
          try { n.disconnect(); } catch {}
        }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const KEYS = Object.keys(P);
    const JACK = { fold: "#d84a3a", symmetry: "#3a7bd8", colour: "#e0b23a", animate: "#3ab86a" };
    const root = document.createElement("div");
    root.className = "fx-wavefolder-root";
    root.innerHTML = `
      <span class="fx-wavefolder-screw" style="top:5px;left:5px"></span>
      <span class="fx-wavefolder-screw" style="top:5px;right:5px"></span>
      <span class="fx-wavefolder-screw" style="bottom:5px;left:5px"></span>
      <span class="fx-wavefolder-screw" style="bottom:5px;right:5px"></span>
      <div class="fx-wavefolder-head">
        <span class="fx-wavefolder-logo">Auric Systems</span>
        <span class="fx-wavefolder-model">wf-16 timbre multiplier</span>
        <span class="fx-wavefolder-badge">west coast</span>
      </div>
      <div class="fx-wavefolder-scope"><canvas></canvas></div>
      <div class="fx-wavefolder-knobs">
        ${KEYS.map((k) => `
          <div class="fx-wavefolder-cell">
            <div class="fx-wavefolder-knob" data-knob="${k}"></div>
            <span class="fx-wavefolder-jack" style="--fx-jack:${JACK[k]}"></span>
            <span class="fx-wavefolder-label">${P[k].label}</span>
            <span class="fx-wavefolder-val" data-val="${k}"></span>
          </div>`).join("")}
      </div>
      ${host.expanded ? `<div class="fx-wavefolder-presets">
        ${this.presets.map((pr, i) => `<button class="fx-wavefolder-preset" data-preset="${i}">${pr.name}</button>`).join("")}
      </div>` : ""}`;
    container.appendChild(root);

    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");

    const fmt = (k, v) => {
      if (k === "fold") return `${v.toFixed(2)}×`;
      if (k === "symmetry") return `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
      if (k === "colour") return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
      return `${Math.round(v * 100)}%`;
    };
    // colour is a frequency → log taper for knob position & drag feel
    const norm = (k, v) => P[k].curve === "log"
      ? Math.log(v / P[k].min) / Math.log(P[k].max / P[k].min)
      : (v - P[k].min) / (P[k].max - P[k].min);
    const denorm = (k, n) => P[k].curve === "log"
      ? P[k].min * Math.exp(n * Math.log(P[k].max / P[k].min))
      : P[k].min + n * (P[k].max - P[k].min);
    const paint = () => {
      const p = host.params;
      for (const k of KEYS) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${-135 + 270 * norm(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
    };
    paint();

    for (const k of KEYS) {
      const el = root.querySelector(`[data-knob="${k}"]`);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, startN = norm(k, host.params[k]);
        const move = (ev) => {
          const n = Math.min(1, Math.max(0, startN + (startY - ev.clientY) / 140));
          let v = denorm(k, n);
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

    for (const btn of root.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => {
        const pr = this.presets[+btn.dataset.preset];
        for (const [k, v] of Object.entries(pr.params)) host.setParam(k, v);
        paint();
      });
    }

    // Oscilloscope: reference sine pushed through the REAL transfer math
    // (bright trace, grows folds with the knob) + the transfer curve itself
    // over the driven input range (dim trace). Animate wobbles the bias in
    // sync with the DSP LFO rate — parameter-driven, no clock in the DSP.
    let raf = 0;
    const t0 = performance.now();
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
      canvas.width = Math.max(1, r.width * d);
      canvas.height = Math.max(1, r.height * d);
    });
    ro.observe(canvas);
    const draw = () => {
      if (!root.isConnected) return;
      const p = host.params;
      const w = canvas.width, h = canvas.height;
      const g = driveFor(p.fold);
      const time = (performance.now() - t0) / 1000;
      const o = biasFor(p) + wobbleDepth(p) * Math.sin(2 * Math.PI * wobbleRate(p) * time);
      const amp = h / 2 - Math.max(3, h * 0.06);
      cx.clearRect(0, 0, w, h);
      // phosphor graticule
      cx.strokeStyle = "#123617"; cx.lineWidth = 1;
      cx.beginPath();
      for (let i = 1; i < 4; i++) { cx.moveTo((w * i) / 4, 0); cx.lineTo((w * i) / 4, h); }
      cx.moveTo(0, h / 2); cx.lineTo(w, h / 2);
      cx.stroke();
      // transfer curve across the driven input range (secondary trace)
      cx.strokeStyle = "#2c7a3a"; cx.lineWidth = Math.max(1, h / 90); cx.beginPath();
      for (let i = 0; i <= w; i++) {
        const s = (i / w) * 2 - 1;
        const y = h / 2 - foldEval(g * s + o) * amp * 0.92;
        i ? cx.lineTo(i, y) : cx.moveTo(i, y);
      }
      cx.stroke();
      // reference sine, folded (primary trace)
      cx.strokeStyle = "#54ff7e"; cx.lineWidth = Math.max(1.5, h / 42);
      cx.shadowColor = "#54ff7e"; cx.shadowBlur = Math.max(2, h / 24);
      cx.beginPath();
      for (let i = 0; i <= w; i++) {
        const s = Math.sin((i / w) * Math.PI * 4);
        const y = h / 2 - foldEval(g * s + o) * amp;
        i ? cx.lineTo(i, y) : cx.moveTo(i, y);
      }
      cx.stroke();
      cx.shadowBlur = 0;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
