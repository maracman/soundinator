// Pattern Delay — clean rhythmic multi-tap digital delay in the spirit of the
// studio rack classics (TC 2290's pristine dotted-eighth lines, Boss DD-series
// tap rhythms). Parallel DelayNodes place 1–3 taps at musical ratios of one
// base time; global feedback regenerates around the LAST tap so the whole
// pattern repeats. Conforms to docs/EFFECTS_CONTRACT.md: mono, offline-safe,
// wet-only output, self-styled 1U rack face with a live dot-matrix tap map.

const PATTERNS = [
  { name: "STRAIGHT", taps: [1] },
  { name: "EIGHTH",   taps: [0.5, 1] },
  { name: "DOTTED",   taps: [0.75, 1] },
  { name: "TRIPLET",  taps: [1 / 3, 2 / 3, 1] },
  { name: "GALLOP",   taps: [0.5, 0.75, 1] },
  { name: "BURST",    taps: [0.25, 0.5, 1] },
];
const NTAPS = 3; // fixed tap slots; late slots host the pattern, feedback always leaves slot 2
const patIdx = (v) => Math.min(PATTERNS.length - 1, Math.max(0, Math.round(v)));

// Per-tap output weights: tilt swings ±9 dB between first and last tap,
// normalised so the pattern's first pass sums to ~unity regardless of tap count.
function tapWeights(pat, tilt) {
  const n = pat.taps.length;
  const w = pat.taps.map((_, i) => {
    const x = n > 1 ? i / (n - 1) : 0.5;
    return Math.pow(10, (tilt * 9 * (x - 0.5)) / 20);
  });
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}

const CSS = `
.fx-pattern-delay-root{width:100%;height:100%;display:flex;box-sizing:border-box;overflow:hidden;
  background:#08090a;border-radius:6px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
  color:#c3c8cd;user-select:none;}
.fx-pattern-delay-root *{box-sizing:border-box;}
.fx-pattern-delay-ear{flex:0 0 16px;position:relative;
  background:linear-gradient(90deg,#2b2e32,#191b1e 60%,#101113);
  border-right:1px solid #000;}
.fx-pattern-delay-ear:last-child{border-right:none;border-left:1px solid #000;
  background:linear-gradient(270deg,#2b2e32,#191b1e 60%,#101113);}
.fx-pattern-delay-ear::before,.fx-pattern-delay-ear::after{content:"";position:absolute;left:50%;
  width:9px;height:9px;margin-left:-4.5px;border-radius:50%;
  background:radial-gradient(circle at 36% 32%,#7b8188,#3a3e43 55%,#0c0d0e);
  box-shadow:inset 0 1px 2px #000c,0 1px 0 #ffffff14;}
.fx-pattern-delay-ear::before{top:9px;}
.fx-pattern-delay-ear::after{bottom:9px;}
.fx-pattern-delay-face{flex:1;min-width:0;display:flex;flex-direction:column;padding:8px 12px 10px;
  background:linear-gradient(180deg,#202225 0%,#17181b 45%,#101113 100%);
  box-shadow:inset 0 1px 0 #ffffff12,inset 0 -1px 0 #000;}
.fx-pattern-delay-head{display:flex;align-items:baseline;gap:10px;flex:0 0 auto;
  padding-bottom:5px;margin-bottom:6px;border-bottom:1px solid #3a3e43;}
.fx-pattern-delay-logo{font-size:14px;font-weight:700;letter-spacing:.24em;color:#e8ebee;
  text-shadow:0 1px 0 #000;}
.fx-pattern-delay-model{font-size:9px;font-weight:600;letter-spacing:.18em;color:#8d939a;
  text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.fx-pattern-delay-pwr{margin-left:auto;flex:0 0 auto;width:8px;height:8px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#b9ffc9,#33e05e 55%,#0c5a24);
  box-shadow:0 0 6px 1px #33e05e88,inset 0 0 2px #063;border:1px solid #0a0c0b;}
.fx-pattern-delay-display{flex:1 1 auto;min-height:56px;margin:0 0 8px;position:relative;
  background:#04120a;border:2px solid #33373b;border-radius:4px;
  box-shadow:inset 0 2px 10px #000e,0 1px 0 #ffffff0e;overflow:hidden;}
.fx-pattern-delay-display canvas{width:100%;height:100%;display:block;}
.fx-pattern-delay-controls{flex:0 0 auto;display:flex;align-items:flex-end;
  justify-content:space-evenly;gap:4px;padding-top:2px;}
.fx-pattern-delay-cell{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:54px;}
.fx-pattern-delay-knob{width:44px;height:44px;border-radius:50%;cursor:ns-resize;position:relative;
  background:radial-gradient(circle at 34% 28%,#5a5f66,#2c2f33 62%,#1a1c1f);
  border:2px solid #0b0c0d;box-shadow:0 3px 6px #000b,inset 0 1px 1px #ffffff2e,0 0 0 1px #3a3e43;}
.fx-pattern-delay-knob::after{content:"";position:absolute;left:50%;top:3px;width:3px;height:15px;
  margin-left:-1.5px;border-radius:1.5px;background:#e8ebee;transform-origin:1.5px 17px;
  transform:rotate(var(--fx-rot,0deg));box-shadow:0 0 2px #000;}
.fx-pattern-delay-label{font-size:8px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  color:#9aa0a7;text-shadow:0 1px 0 #000;}
.fx-pattern-delay-val{font-size:9px;font-family:ui-monospace,Menlo,monospace;color:#58ff7a;
  background:#04120a;border:1px solid #2c2f33;border-radius:2px;padding:1px 5px;min-width:56px;
  text-align:center;text-shadow:0 0 4px #58ff7a66;white-space:nowrap;}
.fx-pattern-delay-sel{display:flex;align-items:center;gap:3px;height:44px;}
.fx-pattern-delay-btn{width:20px;height:26px;border-radius:3px;border:1px solid #0b0c0d;cursor:pointer;
  background:linear-gradient(180deg,#3c4045,#232629);color:#c3c8cd;font-size:9px;line-height:1;
  box-shadow:0 2px 3px #0009,inset 0 1px 0 #ffffff22;padding:0;}
.fx-pattern-delay-btn:active{background:linear-gradient(180deg,#232629,#3c4045);transform:translateY(1px);}
.fx-pattern-delay-presets{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:5px;padding-top:8px;}
.fx-pattern-delay-preset{font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:#c3c8cd;background:linear-gradient(180deg,#33373b,#1d1f22);border:1px solid #0b0c0d;
  border-radius:3px;padding:3px 9px;cursor:pointer;box-shadow:0 2px 3px #0008,inset 0 1px 0 #ffffff1c;}
.fx-pattern-delay-preset:active{background:linear-gradient(180deg,#1d1f22,#33373b);transform:translateY(1px);}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="pattern-delay"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "pattern-delay";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

export default {
  id: "pattern-delay",
  name: "Pattern Delay",
  category: "Delay & Echo",
  description: "Pristine multi-tap digital delay — rhythmic tap patterns at musical ratios of one time.",
  defaults: { time: 0.375, pattern: 2, feedback: 0.45, damp: 9000, tilt: 0 },
  params: {
    time:     { label: "Time",    min: 0.06, max: 1.5,   step: 0.005, unit: "s"  },
    pattern:  { label: "Pattern", min: 0,    max: 5,     step: 1,     unit: ""   },
    feedback: { label: "Regen",   min: 0,    max: 0.85,  step: 0.01,  unit: ""   },
    damp:     { label: "Damp",    min: 800,  max: 16000, step: 10,    unit: "Hz", curve: "log" },
    tilt:     { label: "Tilt",    min: -1,   max: 1,     step: 0.01,  unit: ""   },
  },
  presets: [
    { name: "Dotted 2290",      params: { time: 0.375, pattern: 2, feedback: 0.55, damp: 14000, tilt: 0.2  } },
    { name: "50s Slap",         params: { time: 0.095, pattern: 1, feedback: 0.08, damp: 4500,  tilt: -0.25 } },
    { name: "Triplet Cascade",  params: { time: 0.5,   pattern: 3, feedback: 0.45, damp: 8000,  tilt: 0.35 } },
    { name: "Gallop Runner",    params: { time: 0.31,  pattern: 4, feedback: 0.62, damp: 11000, tilt: 0    } },
    { name: "Dark Burst",       params: { time: 0.72,  pattern: 5, feedback: 0.72, damp: 2200,  tilt: -0.5 } },
  ],
  defaultWet: 0.35,

  build(ctx) {
    const input = ctx.createGain();          // mono in
    const tapIn = ctx.createGain();          // dry + regenerated signal feeding all taps
    const wet = ctx.createGain();            // WET-ONLY sum out (host does the dry mix)
    const damp = ctx.createBiquadFilter();   // lowpass inside the feedback loop
    const fb = ctx.createGain();             // regeneration amount (hard-clamped <= 0.85)
    damp.type = "lowpass";
    damp.Q.value = 0;

    const delays = [];
    const tapOut = [];
    for (let s = 0; s < NTAPS; s++) {
      const d = ctx.createDelay(2);
      const g = ctx.createGain();
      tapIn.connect(d);
      d.connect(g);
      g.connect(wet);
      delays.push(d);
      tapOut.push(g);
    }
    input.connect(tapIn);
    // Feedback taps the LAST slot (always the ratio-1.0 tap, pre-tilt) so the
    // whole pattern repeats each base-time cycle — the classic multi-tap regen.
    delays[NTAPS - 1].connect(damp);
    damp.connect(fb);
    fb.connect(tapIn);

    const apply = (p, immediate) => {
      const t = ctx.currentTime;
      const set = (param, v) => immediate
        ? param.setValueAtTime(v, t)
        : param.setTargetAtTime(v, t, 0.02);
      const pat = PATTERNS[patIdx(p.pattern)];
      const gains = tapWeights(pat, p.tilt);
      const off = NTAPS - pat.taps.length; // pattern occupies the LATE slots
      for (let s = 0; s < NTAPS; s++) {
        const i = s - off;
        if (i >= 0) {
          const dt = Math.min(1.95, Math.max(0.001, p.time * pat.taps[i]));
          if (immediate) delays[s].delayTime.setValueAtTime(dt, t);
          else delays[s].delayTime.setTargetAtTime(dt, t, 0.03);
          set(tapOut[s].gain, gains[i]);
        } else {
          set(tapOut[s].gain, 0);
        }
      }
      set(fb.gain, Math.min(0.85, Math.max(0, p.feedback)));
      set(damp.frequency, Math.min(16000, Math.max(800, p.damp)));
    };
    apply(this.defaults, true);

    return {
      input,
      output: wet,
      update(p) { apply(p, false); },
      dispose() {
        for (const n of [input, tapIn, wet, damp, fb, ...delays, ...tapOut]) {
          try { n.disconnect(); } catch {}
        }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const defaults = this.defaults;
    const KNOBS = ["time", "feedback", "damp", "tilt"];
    const LOG = new Set(["time", "damp"]);

    const root = document.createElement("div");
    root.className = "fx-pattern-delay-root";
    root.innerHTML = `
      <div class="fx-pattern-delay-ear"></div>
      <div class="fx-pattern-delay-face">
        <div class="fx-pattern-delay-head">
          <span class="fx-pattern-delay-logo">TESSERA</span>
          <span class="fx-pattern-delay-model">PD-3 &middot; multi-tap pattern delay &middot; 24-bit</span>
          <span class="fx-pattern-delay-pwr"></span>
        </div>
        <div class="fx-pattern-delay-display"><canvas></canvas></div>
        <div class="fx-pattern-delay-controls">
          <div class="fx-pattern-delay-cell">
            <div class="fx-pattern-delay-sel">
              <button class="fx-pattern-delay-btn" data-pat="-1">&#9664;</button>
              <button class="fx-pattern-delay-btn" data-pat="1">&#9654;</button>
            </div>
            <span class="fx-pattern-delay-label">${P.pattern.label}</span>
            <span class="fx-pattern-delay-val" data-val="pattern"></span>
          </div>
          ${KNOBS.map((k) => `
            <div class="fx-pattern-delay-cell">
              <div class="fx-pattern-delay-knob" data-knob="${k}"></div>
              <span class="fx-pattern-delay-label">${P[k].label}</span>
              <span class="fx-pattern-delay-val" data-val="${k}"></span>
            </div>`).join("")}
        </div>
        ${host.expanded ? `<div class="fx-pattern-delay-presets">
          ${this.presets.map((pr, i) => `<button class="fx-pattern-delay-preset" data-preset="${i}">${pr.name}</button>`).join("")}
        </div>` : ""}
      </div>
      <div class="fx-pattern-delay-ear"></div>`;
    container.appendChild(root);

    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");

    // value <-> knob normalisation (log feel for time & damp)
    const norm = (k, v) => LOG.has(k)
      ? Math.log(v / P[k].min) / Math.log(P[k].max / P[k].min)
      : (v - P[k].min) / (P[k].max - P[k].min);
    const denorm = (k, n) => LOG.has(k)
      ? P[k].min * Math.pow(P[k].max / P[k].min, n)
      : P[k].min + n * (P[k].max - P[k].min);
    const fmt = (k, v) => {
      if (k === "time") return v >= 1 ? `${v.toFixed(2)} s` : `${Math.round(v * 1000)} ms`;
      if (k === "pattern") return PATTERNS[patIdx(v)].name;
      if (k === "feedback") return `${Math.round((v / 0.85) * 100)}%`;
      if (k === "damp") return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
      const t = Math.round(v * 100);
      return t === 0 ? "FLAT" : t < 0 ? `EARLY ${-t}` : `LATE ${t}`;
    };
    const paint = () => {
      const p = host.params;
      for (const k of KNOBS) {
        root.querySelector(`[data-knob="${k}"]`).style
          .setProperty("--fx-rot", `${-135 + 270 * norm(k, p[k])}deg`);
      }
      for (const k of [...KNOBS, "pattern"]) {
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
    };
    paint();

    // knobs: vertical drag, double-click resets
    for (const k of KNOBS) {
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
      el.addEventListener("dblclick", () => { host.setParam(k, defaults[k]); paint(); });
    }
    // pattern stepper (wraps) + double-click reset
    for (const b of root.querySelectorAll("[data-pat]")) {
      b.addEventListener("click", () => {
        const dir = Number(b.dataset.pat);
        const next = (patIdx(host.params.pattern) + dir + PATTERNS.length) % PATTERNS.length;
        host.setParam("pattern", next);
        paint();
      });
      b.addEventListener("dblclick", () => { host.setParam("pattern", defaults.pattern); paint(); });
    }
    // presets (expanded view only)
    for (const b of root.querySelectorAll("[data-preset]")) {
      b.addEventListener("click", () => {
        const pr = this.presets[Number(b.dataset.preset)];
        for (const [k, v] of Object.entries(pr.params)) host.setParam(k, v);
        paint();
      });
    }

    // ---- green dot-matrix LED display -----------------------------------
    // Tap map on a one-cycle timeline; a pulse column sweeps at the ACTUAL
    // base-time rate, taps flash as it passes, heights follow the tilt gains.
    let raf = 0;
    const t0 = performance.now();
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * d));
      canvas.height = Math.max(1, Math.round(r.height * d));
    });
    ro.observe(canvas);

    const draw = () => {
      if (!root.isConnected) return;
      raf = requestAnimationFrame(draw);
      const w = canvas.width, h = canvas.height;
      if (w < 8 || h < 8) return;
      const p = host.params;
      const pat = PATTERNS[patIdx(p.pattern)];
      const gains = tapWeights(pat, p.tilt);
      const gmax = Math.max(...gains);
      const phase = ((performance.now() - t0) / 1000 % p.time) / p.time;

      cx.clearRect(0, 0, w, h);
      cx.fillStyle = "#04120a";
      cx.fillRect(0, 0, w, h);

      const pad = Math.max(6, w * 0.03);
      const textH = Math.max(9, Math.min(h * 0.16, w * 0.045));
      cx.font = `700 ${textH}px ui-monospace,Menlo,monospace`;
      cx.textBaseline = "top";
      cx.shadowColor = "#58ff7a";
      cx.shadowBlur = textH * 0.4;
      cx.fillStyle = "#58ff7a";
      cx.fillText(pat.name, pad, pad * 0.7);
      const tTxt = `${fmt("time", p.time)}  FB ${fmt("feedback", p.feedback)}`.toUpperCase();
      cx.fillText(tTxt, w - pad - cx.measureText(tTxt).width, pad * 0.7);
      cx.shadowBlur = 0;

      // dot grid geometry
      const gridTop = pad * 0.7 + textH + pad * 0.6;
      const gridH = h - gridTop - pad;
      if (gridH < 8) return;
      const pitch = Math.max(4, Math.min(w / 48, gridH / 8));
      const cols = Math.max(16, Math.floor((w - pad * 2) / pitch));
      const rows = Math.max(5, Math.floor(gridH / pitch));
      const px = (c) => pad + (c + 0.5) * ((w - pad * 2) / cols);
      const py = (r) => gridTop + (r + 0.5) * (gridH / rows);
      const dotR = Math.min((w - pad * 2) / cols, gridH / rows) * 0.32;
      const dot = (c, r, a) => {
        cx.fillStyle = `rgba(88,255,122,${a})`;
        cx.beginPath();
        cx.arc(px(c), py(r), dotR, 0, 7);
        cx.fill();
      };
      // unlit matrix
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) dot(c, r, 0.06);
      // baseline
      for (let c = 0; c < cols; c++) dot(c, rows - 1, 0.18);
      // tap columns: height follows tilt-weighted gain, flash decays after the pulse passes
      for (let i = 0; i < pat.taps.length; i++) {
        const c = Math.round(pat.taps[i] * (cols - 1));
        const hh = Math.max(1, Math.round((gains[i] / gmax) * (rows - 1)));
        const since = (phase - pat.taps[i] + 1) % 1;
        const flash = Math.exp(-since * 7);
        for (let r = 0; r < hh; r++) dot(c, rows - 1 - r, 0.4 + 0.6 * flash);
        if (flash > 0.5) { // glow burst on hit
          cx.shadowColor = "#58ff7a"; cx.shadowBlur = dotR * 6;
          dot(c, rows - 1 - (hh - 1), flash);
          cx.shadowBlur = 0;
        }
      }
      // travelling pulse column at the real base-time rate
      const pc = phase * (cols - 1);
      const c0 = Math.round(pc);
      for (let r = 0; r < rows; r++) dot(c0, r, 0.14);
      cx.shadowColor = "#b9ffc9"; cx.shadowBlur = dotR * 5;
      cx.fillStyle = "#b9ffc9";
      cx.beginPath();
      cx.arc(px(pc), py(rows - 1), dotR * 1.25, 0, 7);
      cx.fill();
      cx.shadowBlur = 0;
      // regen meter: right-edge column, height follows feedback amount
      const fbRows = Math.round((Math.min(0.85, p.feedback) / 0.85) * (rows - 1));
      for (let r = 0; r < fbRows; r++) dot(cols - 1, rows - 2 - r, 0.5);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
