// Phaser — classic 4/6/8-stage allpass phaser in the lineage of the MXR
// Phase 90 (4 stages, matched sweep, subtle regen) and the EHX Small Stone
// (color/feedback switch for vocal resonance). Mono, native nodes only,
// offline-safe per docs/EFFECTS_CONTRACT.md. Shaping effect: dry+wet are
// summed at equal blend INSIDE the module (that is what carves the notches),
// so defaultWet is omitted.

const CSS = `
.fx-phaser-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:
    radial-gradient(120% 90% at 30% 0%,#7d54b8 0%,#5b2a86 45%,#3f1a63 100%);
  border-radius:12px;border:1px solid #23103a;position:relative;overflow:hidden;
  box-shadow:inset 0 2px 2px #ffffff40,inset 0 -18px 36px #1b0a3055,inset 0 0 0 3px #ffffff14;
  font-family:Georgia,'Times New Roman',serif;color:#f2e9ff;}
.fx-phaser-root *{box-sizing:border-box;}
.fx-phaser-screw{position:absolute;width:11px;height:11px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#e8e4ee,#8d8798 55%,#4a4553);
  box-shadow:0 1px 2px #0008;pointer-events:none;}
.fx-phaser-screw::after{content:"";position:absolute;left:50%;top:15%;bottom:15%;width:2px;
  margin-left:-1px;background:#3a3542;transform:rotate(35deg);}
.fx-phaser-head{display:flex;align-items:baseline;gap:10px;padding:10px 18px 2px;flex:0 0 auto;}
.fx-phaser-logo{font-family:'Snell Roundhand','Brush Script MT','Segoe Script',cursive;
  font-size:24px;font-weight:700;color:#fdf6d8;text-shadow:0 2px 3px #1b0a30aa,0 0 12px #fdf6d833;
  line-height:1;white-space:nowrap;}
.fx-phaser-sub{font-size:8px;letter-spacing:.32em;text-transform:uppercase;color:#c9b3ec;
  font-family:Futura,'Trebuchet MS',sans-serif;white-space:nowrap;}
.fx-phaser-led{margin-left:auto;width:13px;height:13px;border-radius:50%;flex:0 0 auto;
  background:radial-gradient(circle at 35% 30%,#ffb3c4,#c2183c 60%,#570716);
  border:2px solid #2a123f;box-shadow:0 1px 2px #000a;align-self:center;}
.fx-phaser-comb{margin:4px 14px;height:64px;min-height:34px;flex:0 3 auto;position:relative;
  background:#170d26;border-radius:6px;border:2px solid #23103a;
  box-shadow:inset 0 2px 10px #000d,0 1px 0 #ffffff22;}
.fx-phaser-comb canvas{width:100%;height:100%;display:block;border-radius:4px;}
.fx-phaser-knobs{flex:1 1 auto;display:flex;align-items:center;justify-content:space-evenly;
  padding:4px 8px;min-height:86px;}
.fx-phaser-cell{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:58px;}
.fx-phaser-knob{width:46px;height:46px;border-radius:50%;cursor:ns-resize;position:relative;
  background:radial-gradient(circle at 34% 28%,#fffbe9,#e9dcb4 55%,#b8a878);
  border:2px solid #2a123f;box-shadow:0 3px 7px #0009,inset 0 -3px 6px #8d7c4e66,inset 0 2px 2px #fff;}
.fx-phaser-knob::after{content:"";position:absolute;left:50%;top:3px;width:4px;height:17px;
  margin-left:-2px;border-radius:2px;background:#3f1a63;transform-origin:2px 20px;
  transform:rotate(var(--fx-rot,0deg));}
.fx-phaser-label{font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  color:#e5d7fa;font-family:Futura,'Trebuchet MS',sans-serif;text-shadow:0 1px 1px #1b0a30;}
.fx-phaser-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#3f1a63;
  background:#f4ecda;border:1px solid #23103a;border-radius:3px;padding:0 5px;min-width:50px;text-align:center;}
.fx-phaser-stages{display:flex;border:2px solid #2a123f;border-radius:5px;overflow:hidden;
  box-shadow:0 2px 5px #0008,inset 0 1px 1px #fff3;}
.fx-phaser-stbtn{width:26px;height:30px;display:flex;align-items:center;justify-content:center;
  font-family:Futura,'Trebuchet MS',sans-serif;font-size:11px;font-weight:700;cursor:pointer;
  background:linear-gradient(#6d43a0,#4a2178);color:#c9b3ec;user-select:none;
  border-right:1px solid #2a123f;}
.fx-phaser-stbtn:last-child{border-right:none;}
.fx-phaser-stbtn[data-on="1"]{background:linear-gradient(#fdf6d8,#e2d3a0);color:#3f1a63;
  box-shadow:inset 0 1px 4px #8d7c4e88;}
.fx-phaser-foot{flex:0 2 74px;min-height:36px;display:flex;align-items:center;justify-content:center;
  position:relative;}
.fx-phaser-switch{width:52px;height:52px;max-height:88%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle at 35% 28%,#f0eef4,#a9a3b4 45%,#5c5668 80%,#3a3542);
  border:3px solid #23103a;box-shadow:0 4px 10px #000b,inset 0 2px 3px #fff8,inset 0 -6px 10px #0007;
  position:relative;flex:0 0 auto;}
.fx-phaser-switch::before{content:"";position:absolute;inset:22%;border-radius:50%;
  background:radial-gradient(circle at 40% 32%,#d8d4e0,#7e7889 70%,#4a4553);
  box-shadow:inset 0 1px 2px #fffa,0 1px 3px #0009;}
.fx-phaser-footline{position:absolute;left:16px;right:16px;top:50%;height:2px;background:#2a123f88;
  box-shadow:0 1px 0 #ffffff1c;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="phaser"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "phaser";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// Sweep geometry (shared by DSP and the comb visual):
// centre 720 Hz, depth swings the stages' detune ±(depth·2000) cents →
// full sweep ≈ 190 Hz–2.7 kHz, matching the Phase 90's musical range.
const CENTRE_HZ = 720;
const SWEEP_CENTS = 2000;
const STAGE_OFFSETS = [0.92, 1.0, 1.08, 0.96, 1.05, 0.9, 1.02, 1.1]; // slight stagger for lushness
const FB_MAX = 0.85;

export default {
  id: "phaser",
  name: "Phaser",
  category: "Modulation",
  description: "Swooshing 4/6/8-stage allpass notch sweeps — from script-logo swirl to vocal resonant jet.",
  defaults: { rate: 0.5, depth: 0.7, feedback: 0.25, stages: 4 },
  params: {
    rate:     { label: "Rate",   min: 0.06, max: 8,    step: 0.01, unit: "Hz", curve: "log" },
    depth:    { label: "Depth",  min: 0,    max: 1,    step: 0.01, unit: ""    },
    feedback: { label: "Regen",  min: 0,    max: 0.85, step: 0.01, unit: ""    },
    stages:   { label: "Stages", min: 4,    max: 8,    step: 2,    unit: ""    },
  },
  presets: [
    { name: "Script Swirl",  params: { rate: 0.55, depth: 0.75, feedback: 0.12, stages: 4 } },
    { name: "Stone Color",   params: { rate: 0.38, depth: 0.85, feedback: 0.6,  stages: 4 } },
    { name: "Slow Cathedral",params: { rate: 0.08, depth: 1,    feedback: 0.45, stages: 8 } },
    { name: "Watery Warble", params: { rate: 3.4,  depth: 0.45, feedback: 0.2,  stages: 6 } },
    { name: "Jet Runway",    params: { rate: 0.16, depth: 1,    feedback: 0.8,  stages: 8 } },
  ],

  build(ctx) {
    const input = ctx.createGain();
    const sum = ctx.createGain();          // input + feedback return
    const wetBus = ctx.createGain();       // active-tap chain output
    const fb = ctx.createGain();           // regeneration, hard-limited < 0.85
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const output = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depthGain = ctx.createGain();    // LFO → cents, into every stage's detune

    // 8 allpass stages always built; taps after 4/6/8 crossfade the stage count
    // click-free (no graph rewiring on switch).
    const stages = STAGE_OFFSETS.map((m) => {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = CENTRE_HZ * m;
      ap.Q.value = 0.55;
      return ap;
    });
    const taps = { 4: ctx.createGain(), 6: ctx.createGain(), 8: ctx.createGain() };

    input.connect(sum);
    let prev = sum;
    stages.forEach((ap, i) => {
      prev.connect(ap);
      prev = ap;
      const n = i + 1;
      if (taps[n]) stages[n - 1].connect(taps[n]);
    });
    taps[4].gain.value = 1; taps[6].gain.value = 0; taps[8].gain.value = 0;
    taps[4].connect(wetBus); taps[6].connect(wetBus); taps[8].connect(wetBus);

    wetBus.connect(fb);
    fb.connect(sum);
    fb.gain.value = 0.25;

    // Equal dry/wet blend inside the module — the phase-shifted copy against
    // the dry signal is what creates the notch comb. 0.5+0.5 keeps ~unity.
    input.connect(dry);
    wetBus.connect(wet);
    dry.gain.value = 0.5;
    wet.gain.value = 0.5;
    dry.connect(output);
    wet.connect(output);

    lfo.type = "sine";
    lfo.frequency.value = 0.5;
    depthGain.gain.value = 0.7 * SWEEP_CENTS;
    lfo.connect(depthGain);
    for (const ap of stages) depthGain.connect(ap.detune);
    lfo.start(ctx.currentTime);

    return {
      input,
      output,
      update(p) {
        const t = ctx.currentTime;
        lfo.frequency.setTargetAtTime(p.rate, t, 0.02);
        depthGain.gain.setTargetAtTime(p.depth * SWEEP_CENTS, t, 0.02);
        fb.gain.setTargetAtTime(Math.min(FB_MAX, Math.max(0, p.feedback)), t, 0.02);
        const n = Math.round(p.stages);
        for (const k of [4, 6, 8]) {
          taps[k].gain.setTargetAtTime(k === n ? 1 : 0, t, 0.03);
        }
      },
      dispose() {
        try { lfo.stop(); } catch {}
        const all = [input, sum, wetBus, fb, dry, wet, output, lfo, depthGain,
          ...stages, taps[4], taps[6], taps[8]];
        for (const nd of all) { try { nd.disconnect(); } catch {} }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const defaults = this.defaults;
    const root = document.createElement("div");
    root.className = "fx-phaser-root";
    root.innerHTML = `
      <span class="fx-phaser-screw" style="left:6px;top:6px"></span>
      <span class="fx-phaser-screw" style="right:6px;top:6px"></span>
      <span class="fx-phaser-screw" style="left:6px;bottom:6px"></span>
      <span class="fx-phaser-screw" style="right:6px;bottom:6px"></span>
      <div class="fx-phaser-head">
        <span class="fx-phaser-logo">Nightjar</span>
        <span class="fx-phaser-sub">vortex phase unit</span>
        <span class="fx-phaser-led" data-led></span>
      </div>
      <div class="fx-phaser-comb"><canvas></canvas></div>
      <div class="fx-phaser-knobs">
        ${["rate", "depth", "feedback"].map((k) => `
          <div class="fx-phaser-cell">
            <div class="fx-phaser-knob" data-knob="${k}"></div>
            <span class="fx-phaser-label">${P[k].label}</span>
            <span class="fx-phaser-val" data-val="${k}"></span>
          </div>`).join("")}
        <div class="fx-phaser-cell">
          <div class="fx-phaser-stages" data-stages>
            ${[4, 6, 8].map((n) => `<span class="fx-phaser-stbtn" data-st="${n}">${n}</span>`).join("")}
          </div>
          <span class="fx-phaser-label">${P.stages.label}</span>
          <span class="fx-phaser-val" data-val="stages"></span>
        </div>
      </div>
      <div class="fx-phaser-foot">
        <span class="fx-phaser-footline"></span>
        <div class="fx-phaser-switch" title="Bypass is handled by the host"></div>
      </div>`;
    container.appendChild(root);

    const led = root.querySelector("[data-led]");
    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");

    const fmt = (k, v) =>
      k === "rate" ? `${v.toFixed(2)} Hz`
      : k === "stages" ? `${Math.round(v)} stg`
      : `${Math.round(v * 100)}%`;
    const rotFor = (k, v) => -135 + 270 * (v - P[k].min) / (P[k].max - P[k].min);
    const paint = () => {
      const p = host.params;
      for (const k of ["rate", "depth", "feedback"]) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rotFor(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
      root.querySelector('[data-val="stages"]').textContent = fmt("stages", p.stages);
      for (const b of root.querySelectorAll("[data-st]")) {
        b.dataset.on = Number(b.dataset.st) === Math.round(p.stages) ? "1" : "0";
      }
    };
    paint();

    // knobs: vertical drag, double-click resets
    for (const k of ["rate", "depth", "feedback"]) {
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
      el.addEventListener("dblclick", () => { host.setParam(k, defaults[k]); paint(); });
    }
    // stage selector: click a segment; double-click resets
    const stEl = root.querySelector("[data-stages]");
    stEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-st]");
      if (b) { host.setParam("stages", Number(b.dataset.st)); paint(); }
    });
    stEl.addEventListener("dblclick", () => { host.setParam("stages", defaults.stages); paint(); });

    // Comb visual: notch response strip sweeping at the LFO rate + rate LED.
    // Log-frequency axis 80 Hz–6 kHz; notch count = stages/2; regen deepens
    // notches and raises the resonant humps between them.
    const FMIN = 80, FMAX = 6000;
    const xOf = (f, w) => (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * w;
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
      const phase = ((performance.now() - t0) / 1000 * p.rate) % 1;
      const s = Math.sin(phase * 2 * Math.PI);
      const centre = CENTRE_HZ * Math.pow(2, (s * p.depth * SWEEP_CENTS) / 1200);
      const m = Math.round(p.stages) / 2;               // notch count
      const notches = [];
      for (let k = 0; k < m; k++) notches.push(centre * Math.pow(2, (k - (m - 1) / 2) * 0.9));
      cx.clearRect(0, 0, w, h);
      // sweep-range shading
      const lo = xOf(CENTRE_HZ * Math.pow(2, -p.depth * SWEEP_CENTS / 1200), w);
      const hi = xOf(CENTRE_HZ * Math.pow(2, p.depth * SWEEP_CENTS / 1200), w);
      cx.fillStyle = "#5b2a8626";
      cx.fillRect(lo, 0, Math.max(1, hi - lo), h);
      // response curve
      const sigma = 0.13 - p.feedback * 0.05;           // regen narrows the notches
      cx.strokeStyle = "#c9b3ec"; cx.lineWidth = Math.max(1.5, h / 30); cx.beginPath();
      for (let i = 0; i <= w; i++) {
        const f = FMIN * Math.pow(FMAX / FMIN, i / w);
        let g = 1;
        for (let k = 0; k < notches.length; k++) {
          const d = Math.log2(f / notches[k]);
          g *= 1 - Math.exp(-(d * d) / (2 * sigma * sigma));
          if (k > 0) {                                  // resonant hump between notches
            const mid = Math.sqrt(notches[k] * notches[k - 1]);
            const dm = Math.log2(f / mid);
            g *= 1 + p.feedback * 0.9 * Math.exp(-(dm * dm) / (2 * sigma * sigma));
          }
        }
        g = Math.min(1.6, g);
        const y = h - 4 - g * (h - 8) / 1.6;
        i ? cx.lineTo(i, y) : cx.moveTo(i, y);
      }
      cx.stroke();
      // notch markers
      cx.fillStyle = "#fdf6d8";
      for (const nf of notches) {
        const x = xOf(nf, w);
        if (x > 0 && x < w) { cx.beginPath(); cx.arc(x, h - 5, Math.max(1.5, h / 24), 0, 7); cx.fill(); }
      }
      // rate LED blink
      const glow = 0.3 + 0.7 * (0.5 + 0.5 * s);
      led.style.boxShadow = `0 0 ${9 * glow}px ${3 * glow}px rgba(220,30,70,${0.6 * glow}), 0 1px 2px #000a`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
