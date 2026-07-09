// Tremolo — vintage amp bias-tremolo. Exemplar module for the effects
// contract (docs/EFFECTS_CONTRACT.md): mono DSP, offline-safe, self-styled
// skeuomorphic face with parameter-driven visual feedback.

const CSS = `
.fx-tremolo-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:linear-gradient(175deg,#f3e6c8 0%,#e8d7b0 55%,#d9c391 100%);
  border-radius:10px;border:1px solid #8a6f42;box-shadow:inset 0 1px 0 #fff8,inset 0 -14px 30px #8a6f4222;
  font-family:Futura,'Trebuchet MS',sans-serif;color:#4a3820;overflow:hidden;position:relative;}
.fx-tremolo-root *{box-sizing:border-box;}
.fx-tremolo-head{display:flex;align-items:center;gap:10px;padding:10px 14px 6px;}
.fx-tremolo-logo{font-size:15px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:#6b4f26;text-shadow:0 1px 0 #fff9;}
.fx-tremolo-sub{font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:#8a6f42;}
.fx-tremolo-lamp{margin-left:auto;width:16px;height:16px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ffd7d0,#a03024 55%,#5c130c);
  border:2px solid #7a5c30;box-shadow:0 0 0 2px #d9c391,0 1px 2px #0006;}
.fx-tremolo-scope{margin:2px 14px;height:56px;min-height:36px;flex:0 1 auto;
  background:#1d150c;border-radius:6px;border:2px solid #8a6f42;box-shadow:inset 0 2px 8px #000c;}
.fx-tremolo-scope canvas{width:100%;height:100%;display:block;}
.fx-tremolo-knobs{flex:1;display:flex;align-items:center;justify-content:space-evenly;
  padding:6px 8px 12px;min-height:0;}
.fx-tremolo-cell{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:64px;}
.fx-tremolo-knob{width:52px;height:52px;border-radius:50%;cursor:ns-resize;position:relative;
  background:radial-gradient(circle at 32% 28%,#3d3227,#17120b 70%);
  border:3px solid #c9b184;box-shadow:0 3px 6px #0007,inset 0 1px 1px #fff3;}
.fx-tremolo-knob::after{content:"";position:absolute;left:50%;top:4px;width:4px;height:18px;
  margin-left:-2px;border-radius:2px;background:#f3e6c8;transform-origin:2px 22px;
  transform:rotate(var(--fx-rot,0deg));}
.fx-tremolo-label{font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#6b4f26;}
.fx-tremolo-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#4a3820;
  background:#fff7e4;border:1px solid #c9b184;border-radius:3px;padding:0 5px;min-width:52px;text-align:center;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="tremolo"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "tremolo";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

function shapeCurve(shape) {
  // 0 → sine (identity), 1 → near-square. tanh soft limiter on the LFO.
  const k = 0.5 + shape * 14;
  const n = 257, c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

export default {
  id: "tremolo",
  name: "Tremolo",
  category: "Modulation",
  description: "Vintage amp bias tremolo — throbbing volume waves from a lazy shimmer to a hard chop.",
  defaults: { rate: 4.6, depth: 0.55, shape: 0.15 },
  params: {
    rate:  { label: "Speed",     min: 0.4, max: 14, step: 0.05, unit: "Hz" },
    depth: { label: "Intensity", min: 0,   max: 1,  step: 0.01, unit: ""   },
    shape: { label: "Contour",   min: 0,   max: 1,  step: 0.01, unit: ""   },
  },
  presets: [
    { name: "Smoky Lounge",  params: { rate: 3.2,  depth: 0.4,  shape: 0.05 } },
    { name: "Surf Chop",     params: { rate: 6.5,  depth: 0.85, shape: 0.8  } },
    { name: "Slow Tide",     params: { rate: 0.9,  depth: 0.65, shape: 0.1  } },
    { name: "Helicopter",    params: { rate: 11.5, depth: 1,    shape: 0.95 } },
  ],

  build(ctx) {
    const input = ctx.createGain();
    const gate = ctx.createGain();
    const lfo = ctx.createOscillator();
    const shaper = ctx.createWaveShaper();
    const depthGain = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 4.6;
    shaper.curve = shapeCurve(0.15);
    depthGain.gain.value = 0;
    gate.gain.value = 1;
    input.connect(gate);
    lfo.connect(shaper);
    shaper.connect(depthGain);
    depthGain.connect(gate.gain);
    lfo.start(ctx.currentTime);
    let curShape = 0.15;
    return {
      input,
      output: gate,
      update(p) {
        const t = ctx.currentTime;
        lfo.frequency.setTargetAtTime(p.rate, t, 0.02);
        // carrier sits at 1 - depth/2, LFO swings ±depth/2 → peaks at unity
        gate.gain.setTargetAtTime(1 - p.depth * 0.5, t, 0.02);
        depthGain.gain.setTargetAtTime(p.depth * 0.5, t, 0.02);
        if (Math.abs(p.shape - curShape) > 0.004) {
          curShape = p.shape;
          shaper.curve = shapeCurve(p.shape);
        }
      },
      dispose() {
        try { lfo.stop(); } catch {}
        for (const n of [input, gate, lfo, shaper, depthGain]) { try { n.disconnect(); } catch {} }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const root = document.createElement("div");
    root.className = "fx-tremolo-root";
    root.innerHTML = `
      <div class="fx-tremolo-head">
        <span class="fx-tremolo-logo">Vibra-Verb</span>
        <span class="fx-tremolo-sub">bias tremolo · model 23</span>
        <span class="fx-tremolo-lamp" data-lamp></span>
      </div>
      <div class="fx-tremolo-scope"><canvas></canvas></div>
      <div class="fx-tremolo-knobs">
        ${["rate", "depth", "shape"].map((k) => `
          <div class="fx-tremolo-cell">
            <div class="fx-tremolo-knob" data-knob="${k}"></div>
            <span class="fx-tremolo-label">${P[k].label}</span>
            <span class="fx-tremolo-val" data-val="${k}"></span>
          </div>`).join("")}
      </div>`;
    container.appendChild(root);

    const lamp = root.querySelector("[data-lamp]");
    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");

    const fmt = (k, v) => k === "rate" ? `${v.toFixed(1)} Hz` : `${Math.round(v * 100)}%`;
    const rotFor = (k, v) => -135 + 270 * (v - P[k].min) / (P[k].max - P[k].min);
    const paint = () => {
      const p = host.params;
      for (const k of Object.keys(P)) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rotFor(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
    };
    paint();

    // knob drag: vertical, double-click resets
    for (const k of Object.keys(P)) {
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

    // scope: LFO waveform + travelling phase dot + lamp glow, param-driven
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
      const k = 0.5 + p.shape * 14, norm = Math.tanh(k);
      const phase = ((performance.now() - t0) / 1000 * p.rate) % 1;
      cx.clearRect(0, 0, w, h);
      cx.strokeStyle = "#e8b34a"; cx.lineWidth = Math.max(1.5, h / 34); cx.beginPath();
      for (let i = 0; i <= w; i++) {
        const s = Math.tanh(k * Math.sin((i / w) * Math.PI * 4)) / norm;
        const y = h / 2 - s * (h / 2 - 4) * p.depth;
        i ? cx.lineTo(i, y) : cx.moveTo(i, y);
      }
      cx.stroke();
      const dx = ((phase * 0.5) % 1) * w;
      const ds = Math.tanh(k * Math.sin(phase * 2 * Math.PI)) / norm;
      cx.fillStyle = "#fff3d0"; cx.beginPath();
      cx.arc(dx, h / 2 - ds * (h / 2 - 4) * p.depth, Math.max(2.5, h / 16), 0, 7); cx.fill();
      const glow = 0.35 + 0.65 * Math.max(0, ds) * p.depth;
      lamp.style.boxShadow = `0 0 ${8 * glow}px ${3 * glow}px rgba(224,60,40,${0.55 * glow}), 0 0 0 2px #d9c391`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
