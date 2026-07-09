// Tube Drive — valve preamp saturation (Drive & Dirt). Tube Screamer-style
// topology: mid-focused pre-emphasis into an asymmetric tanh clipper, post
// lowpass tone tilt, and RMS-measured output compensation so loudness stays
// roughly constant across the drive sweep. Contract: docs/EFFECTS_CONTRACT.md.

const CSS = `
.fx-tube-drive-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:linear-gradient(178deg,#3a3d43 0%,#2a2c31 40%,#1d1e22 100%);
  background-image:repeating-linear-gradient(90deg,#ffffff05 0 1px,transparent 1px 3px),
    linear-gradient(178deg,#3a3d43 0%,#2a2c31 40%,#1d1e22 100%);
  border-radius:10px;border:1px solid #0c0d0f;box-shadow:inset 0 1px 0 #ffffff1c,inset 0 -18px 34px #00000066;
  font-family:'Avenir Next','Helvetica Neue',Arial,sans-serif;color:#b8bdc6;overflow:hidden;position:relative;}
.fx-tube-drive-root *{box-sizing:border-box;}
.fx-tube-drive-screw{position:absolute;width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#8d939c,#4a4e55 60%,#26282c);
  box-shadow:0 1px 1px #000a,inset 0 0 0 1px #0007;pointer-events:none;}
.fx-tube-drive-screw::after{content:"";position:absolute;left:1px;right:1px;top:50%;height:1px;
  background:#181a1d;transform:rotate(40deg);}
.fx-tube-drive-head{display:flex;align-items:baseline;gap:10px;padding:10px 18px 4px;flex:0 0 auto;}
.fx-tube-drive-logo{font-size:15px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;
  color:#d8dce2;text-shadow:0 1px 1px #000c,0 -1px 0 #ffffff12;}
.fx-tube-drive-sub{font-size:8px;letter-spacing:.3em;text-transform:uppercase;color:#7d838d;
  text-shadow:0 1px 0 #000a;}
.fx-tube-drive-jewel{margin-left:auto;align-self:center;width:13px;height:13px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ffc9a0,#c25a18 55%,#5c2306);
  border:2px solid #14151a;box-shadow:0 0 0 2px #4a4e55,0 1px 2px #000a;}
.fx-tube-drive-main{flex:1 1 auto;display:flex;gap:10px;padding:4px 14px;min-height:0;}
.fx-tube-drive-tubewin{flex:0 0 34%;min-width:86px;border-radius:8px;position:relative;
  background:linear-gradient(180deg,#101114,#08090b 70%);
  border:2px solid #4a4e55;box-shadow:inset 0 2px 10px #000e,inset 0 0 0 1px #000;overflow:hidden;}
.fx-tube-drive-tubewin canvas,.fx-tube-drive-curvewin canvas{width:100%;height:100%;display:block;}
.fx-tube-drive-curvewin{flex:1 1 auto;border-radius:8px;position:relative;
  background:linear-gradient(180deg,#0d1210,#080b0a 70%);
  border:2px solid #4a4e55;box-shadow:inset 0 2px 10px #000e,inset 0 0 0 1px #000;overflow:hidden;}
.fx-tube-drive-tag{position:absolute;left:6px;top:4px;font-size:7px;letter-spacing:.28em;
  text-transform:uppercase;color:#6a707a;pointer-events:none;text-shadow:0 1px 0 #000;}
.fx-tube-drive-knobs{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:space-evenly;
  padding:8px 8px 12px;}
.fx-tube-drive-cell{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:58px;}
.fx-tube-drive-knob{width:48px;height:48px;border-radius:50%;cursor:ns-resize;position:relative;
  background:radial-gradient(circle at 34% 28%,#2c2620,#0f0c09 72%);
  border:3px solid #8d7a52;box-shadow:0 3px 7px #000b,inset 0 1px 1px #ffffff2a,0 0 0 1px #000;}
.fx-tube-drive-knob::after{content:"";position:absolute;left:50%;top:4px;width:4px;height:16px;
  margin-left:-2px;border-radius:2px;background:#efe6cf;box-shadow:0 0 2px #000;
  transform-origin:2px 20px;transform:rotate(var(--fx-rot,0deg));}
.fx-tube-drive-label{font-size:8px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;
  color:#9aa0aa;text-shadow:0 1px 1px #000c;}
.fx-tube-drive-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#ffb066;
  background:#111214;border:1px solid #4a4e55;border-radius:3px;padding:0 5px;min-width:56px;
  text-align:center;box-shadow:inset 0 1px 3px #000c;}
.fx-tube-drive-presets{display:none;gap:6px;padding:0 14px 10px;flex:0 0 auto;flex-wrap:wrap;}
.fx-tube-drive-expanded .fx-tube-drive-presets{display:flex;}
.fx-tube-drive-preset{font-size:9px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;
  color:#c8cdd5;background:linear-gradient(180deg,#3d4046,#26282c);border:1px solid #14151a;
  border-radius:4px;padding:3px 9px;box-shadow:0 1px 2px #0009,inset 0 1px 0 #ffffff14;}
.fx-tube-drive-preset:hover{color:#ffb066;border-color:#8d7a52;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="tube-drive"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "tube-drive";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- shared DSP mappings (used by build() and the UI transfer plot) ----
// Drive 0..10 → 3..33 dB of gain into the clipper (TS-style range tops out
// well under fuzz territory; every point of the sweep stays musical).
const driveDb = (d) => 3 + d * 3.0;
const kneeK = (d) => 1.8 + d * 0.5;        // knee hardness rises with drive
const biasShift = (b) => b * 0.32;          // curve asymmetry from bias -1..1
const preBoostDb = (d) => 2 + d * 0.8;      // 740 Hz mid hump, 2..10 dB
const toneHz = (t) => 700 * Math.pow(9000 / 700, t); // log 700 Hz..9 kHz

// Normalised asymmetric soft-clip shape (DC term removed so silence stays silent).
function shapeFn(d, b) {
  const k = kneeK(d), s = biasShift(b);
  const raw = (x) => Math.tanh(k * (x + s)) - Math.tanh(k * s);
  const norm = Math.max(Math.abs(raw(1)), Math.abs(raw(-1)), 1e-6);
  return (x) => raw(x) / norm;
}

function makeCurve(d, b) {
  const f = shapeFn(d, b);
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = f((i / (n - 1)) * 2 - 1);
  return c;
}

// Output compensation, measured: run a reference sine (amp 0.45) through the
// pre-gain + curve numerically, compare RMS in/out, then shave a share of the
// mid pre-emphasis. Keeps loudness within a couple of dB across the sweep.
function compGain(d, b) {
  const g = Math.pow(10, driveDb(d) / 20);
  const f = shapeFn(d, b);
  const a0 = 0.45, N = 64;
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const y = f(clamp(g * a0 * Math.sin((i / N) * 2 * Math.PI), -1, 1));
    acc += y * y;
  }
  const outRms = Math.sqrt(acc / N);
  let comp = (a0 / Math.SQRT2) / Math.max(outRms, 1e-4);
  comp *= Math.pow(10, -(preBoostDb(d) * 0.35) / 20);
  return clamp(comp, 0.05, 2.5);
}

export default {
  id: "tube-drive",
  name: "Tube Drive",
  category: "Drive & Dirt",
  description: "Valve preamp saturation — mid-forward warm glow to raunchy asymmetric overdrive.",
  defaults: { drive: 3.5, bias: 0.25, tone: 0.55, output: 0 },
  params: {
    drive:  { label: "Drive",  min: 0,   max: 10, step: 0.1,  unit: ""   },
    bias:   { label: "Bias",   min: -1,  max: 1,  step: 0.01, unit: ""   },
    tone:   { label: "Tone",   min: 0,   max: 1,  step: 0.01, unit: ""   },
    output: { label: "Output", min: -12, max: 12, step: 0.1,  unit: "dB" },
  },
  presets: [
    { name: "Warm Glow",     params: { drive: 1.6, bias: 0.35, tone: 0.45, output: 0   } },
    { name: "Blues Break",   params: { drive: 3.8, bias: 0.2,  tone: 0.6,  output: 0   } },
    { name: "Green Scream",  params: { drive: 6.2, bias: 0.1,  tone: 0.68, output: 0   } },
    { name: "Velvet Fuzz",   params: { drive: 8.8, bias: 0.55, tone: 0.3,  output: 0   } },
    { name: "Crystal Boost", params: { drive: 0.6, bias: 0.05, tone: 0.9,  output: 1.5 } },
  ],

  build(ctx) {
    const D = { drive: 3.5, bias: 0.25, tone: 0.55, output: 0 };
    const input = ctx.createGain();
    const pre = ctx.createBiquadFilter();     // mid-focused pre-emphasis
    pre.type = "peaking";
    pre.frequency.value = 740;
    pre.Q.value = 0.9;
    pre.gain.value = preBoostDb(D.drive);
    const driveGain = ctx.createGain();
    driveGain.gain.value = Math.pow(10, driveDb(D.drive) / 20);
    const shaper = ctx.createWaveShaper();
    shaper.oversample = "4x";
    shaper.curve = makeCurve(D.drive, D.bias);
    const dcBlock = ctx.createBiquadFilter(); // asymmetric clip → strip DC
    dcBlock.type = "highpass";
    dcBlock.frequency.value = 24;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.Q.value = 0.6;
    tone.frequency.value = toneHz(D.tone);
    const out = ctx.createGain();
    out.gain.value = compGain(D.drive, D.bias);

    input.connect(pre);
    pre.connect(driveGain);
    driveGain.connect(shaper);
    shaper.connect(dcBlock);
    dcBlock.connect(tone);
    tone.connect(out);

    let lastDrive = D.drive, lastBias = D.bias;
    return {
      input,
      output: out,
      update(p) {
        const t = ctx.currentTime;
        pre.gain.setTargetAtTime(preBoostDb(p.drive), t, 0.02);
        driveGain.gain.setTargetAtTime(Math.pow(10, driveDb(p.drive) / 20), t, 0.02);
        if (Math.abs(p.drive - lastDrive) > 0.05 || Math.abs(p.bias - lastBias) > 0.008) {
          lastDrive = p.drive; lastBias = p.bias;
          shaper.curve = makeCurve(p.drive, p.bias);
        }
        tone.frequency.setTargetAtTime(toneHz(p.tone), t, 0.02);
        out.gain.setTargetAtTime(
          compGain(p.drive, p.bias) * Math.pow(10, p.output / 20), t, 0.02);
      },
      dispose() {
        for (const n of [input, pre, driveGain, shaper, dcBlock, tone, out]) {
          try { n.disconnect(); } catch {}
        }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const DEF = this.defaults;
    const root = document.createElement("div");
    root.className = "fx-tube-drive-root" + (host.expanded ? " fx-tube-drive-expanded" : "");
    root.innerHTML = `
      <span class="fx-tube-drive-screw" style="left:5px;top:5px"></span>
      <span class="fx-tube-drive-screw" style="right:5px;top:5px"></span>
      <span class="fx-tube-drive-screw" style="left:5px;bottom:5px"></span>
      <span class="fx-tube-drive-screw" style="right:5px;bottom:5px"></span>
      <div class="fx-tube-drive-head">
        <span class="fx-tube-drive-logo">Ohmwerk</span>
        <span class="fx-tube-drive-sub">valvestone vt-88 &middot; class a preamp</span>
        <span class="fx-tube-drive-jewel" data-jewel></span>
      </div>
      <div class="fx-tube-drive-main">
        <div class="fx-tube-drive-tubewin"><canvas data-tube></canvas>
          <span class="fx-tube-drive-tag">valve</span></div>
        <div class="fx-tube-drive-curvewin"><canvas data-curve></canvas>
          <span class="fx-tube-drive-tag">transfer</span></div>
      </div>
      <div class="fx-tube-drive-knobs">
        ${Object.keys(P).map((k) => `
          <div class="fx-tube-drive-cell">
            <div class="fx-tube-drive-knob" data-knob="${k}"></div>
            <span class="fx-tube-drive-label">${P[k].label}</span>
            <span class="fx-tube-drive-val" data-val="${k}"></span>
          </div>`).join("")}
      </div>
      <div class="fx-tube-drive-presets">
        ${this.presets.map((pr, i) => `
          <button class="fx-tube-drive-preset" data-preset="${i}">${pr.name}</button>`).join("")}
      </div>`;
    container.appendChild(root);

    const jewel = root.querySelector("[data-jewel]");
    const tubeCv = root.querySelector("[data-tube]");
    const curveCv = root.querySelector("[data-curve]");
    const tcx = tubeCv.getContext("2d");
    const ccx = curveCv.getContext("2d");

    const fmt = (k, v) =>
      k === "drive" ? v.toFixed(1)
      : k === "output" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`
      : `${v >= 0 && k === "bias" ? "+" : ""}${Math.round(v * 100)}%`;
    const rotFor = (k, v) => -135 + 270 * (v - P[k].min) / (P[k].max - P[k].min);

    const drawCurve = () => {
      const p = host.params;
      const w = curveCv.width, h = curveCv.height;
      if (!w || !h) return;
      const pad = Math.max(4, h * 0.07);
      ccx.clearRect(0, 0, w, h);
      ccx.strokeStyle = "#1e2b24"; ccx.lineWidth = 1; ccx.beginPath();
      for (let i = 1; i < 4; i++) {
        ccx.moveTo((w / 4) * i, 0); ccx.lineTo((w / 4) * i, h);
        ccx.moveTo(0, (h / 4) * i); ccx.lineTo(w, (h / 4) * i);
      }
      ccx.stroke();
      ccx.strokeStyle = "#2c3a32"; ccx.setLineDash([3, 4]); ccx.beginPath();
      ccx.moveTo(0, h - pad); ccx.lineTo(w, pad); ccx.stroke(); ccx.setLineDash([]);
      const f = shapeFn(p.drive, p.bias);
      const g = Math.pow(10, driveDb(p.drive) / 20);
      ccx.strokeStyle = "#ff9b3d"; ccx.lineWidth = Math.max(1.5, h / 60);
      ccx.shadowColor = "#ff7a1a"; ccx.shadowBlur = Math.max(2, h / 40);
      ccx.beginPath();
      for (let i = 0; i <= w; i++) {
        const x = (i / w) * 2 - 1;
        const y = f(clamp(g * x * 0.5, -1, 1)); // half-scale in → knee visible
        const py = h / 2 - y * (h / 2 - pad);
        i ? ccx.lineTo(i, py) : ccx.moveTo(i, py);
      }
      ccx.stroke();
      ccx.shadowBlur = 0;
    };

    const paint = () => {
      const p = host.params;
      for (const k of Object.keys(P)) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rotFor(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
      drawCurve();
    };

    for (const k of Object.keys(P)) {
      const el = root.querySelector(`[data-knob="${k}"]`);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, startV = host.params[k];
        const range = P[k].max - P[k].min;
        const move = (ev) => {
          let v = startV + (startY - ev.clientY) / 140 * range;
          v = clamp(Math.round(v / P[k].step) * P[k].step, P[k].min, P[k].max);
          host.setParam(k, v);
          paint();
        };
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      });
      el.addEventListener("dblclick", () => { host.setParam(k, DEF[k]); paint(); });
    }

    for (const btn of root.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => {
        const pr = this.presets[+btn.dataset.preset];
        for (const [k, v] of Object.entries(pr.params)) host.setParam(k, v);
        paint();
      });
    }

    // ---- animated valve: glow follows drive, plus real signal level ----
    const ro = new ResizeObserver(() => {
      const d = devicePixelRatio || 1;
      for (const cv of [tubeCv, curveCv]) {
        const r = cv.getBoundingClientRect();
        cv.width = Math.max(1, r.width * d);
        cv.height = Math.max(1, r.height * d);
      }
      drawCurve();
    });
    ro.observe(tubeCv);
    ro.observe(curveCv);

    let raf = 0, lev = 0, buf = null, lastKey = "";
    const drawTube = () => {
      if (!root.isConnected) return;
      const p = host.params;
      const key = `${p.drive}|${p.bias}`;
      if (key !== lastKey) { lastKey = key; drawCurve(); }
      if (host.analyser) {
        if (!buf || buf.length !== host.analyser.fftSize) buf = new Uint8Array(host.analyser.fftSize);
        host.analyser.getByteTimeDomainData(buf);
        let acc = 0;
        for (let i = 0; i < buf.length; i += 4) { const s = (buf[i] - 128) / 128; acc += s * s; }
        lev += (Math.sqrt(acc / (buf.length / 4)) - lev) * 0.25;
      } else {
        lev *= 0.95;
      }
      const glow = clamp(0.18 + 0.5 * (p.drive / 10) + lev * 1.6, 0, 1);
      const w = tubeCv.width, h = tubeCv.height;
      if (!w || !h) { raf = requestAnimationFrame(drawTube); return; }
      const cx0 = w / 2, gw = Math.min(w * 0.44, h * 0.38);
      const top = h * 0.12, bot = h * 0.86;
      tcx.clearRect(0, 0, w, h);
      // ambient spill behind the glass
      let gr = tcx.createRadialGradient(cx0, h * 0.5, 0, cx0, h * 0.5, h * 0.55);
      gr.addColorStop(0, `rgba(255,130,40,${0.28 * glow})`);
      gr.addColorStop(1, "rgba(255,130,40,0)");
      tcx.fillStyle = gr; tcx.fillRect(0, 0, w, h);
      // glass envelope (dome top, straight sides)
      tcx.beginPath();
      tcx.moveTo(cx0 - gw / 2, bot);
      tcx.lineTo(cx0 - gw / 2, top + gw / 2);
      tcx.arc(cx0, top + gw / 2, gw / 2, Math.PI, 0);
      tcx.lineTo(cx0 + gw / 2, bot);
      tcx.closePath();
      tcx.fillStyle = "rgba(150,175,200,0.06)";
      tcx.strokeStyle = "rgba(190,210,235,0.35)";
      tcx.lineWidth = Math.max(1, h / 130);
      tcx.fill(); tcx.stroke();
      // getter flash at the dome
      tcx.beginPath();
      tcx.ellipse(cx0, top + gw * 0.32, gw * 0.26, gw * 0.13, 0, 0, 7);
      tcx.fillStyle = "rgba(160,170,185,0.5)"; tcx.fill();
      // anode plate
      const pw = gw * 0.52, ph = (bot - top) * 0.46, py0 = top + (bot - top) * 0.3;
      tcx.fillStyle = "#2a2d33";
      tcx.fillRect(cx0 - pw / 2, py0, pw, ph);
      tcx.strokeStyle = "#4a4e55"; tcx.strokeRect(cx0 - pw / 2, py0, pw, ph);
      // filament glow through the plate slit
      gr = tcx.createRadialGradient(cx0, py0 + ph / 2, 0, cx0, py0 + ph / 2, gw * (0.28 + glow * 0.55));
      gr.addColorStop(0, `rgba(255,190,110,${0.95 * glow})`);
      gr.addColorStop(0.4, `rgba(255,120,35,${0.6 * glow})`);
      gr.addColorStop(1, "rgba(255,90,20,0)");
      tcx.fillStyle = gr;
      tcx.fillRect(cx0 - gw / 2, top, gw, bot - top);
      tcx.fillStyle = `rgba(255,225,170,${0.55 + 0.45 * glow})`;
      tcx.fillRect(cx0 - Math.max(1, gw * 0.03), py0 + ph * 0.12, Math.max(2, gw * 0.06), ph * 0.76);
      // socket + pins
      tcx.fillStyle = "#131418";
      tcx.fillRect(cx0 - gw * 0.62, bot, gw * 1.24, h * 0.08);
      jewel.style.boxShadow =
        `0 0 ${10 * glow}px ${4 * glow}px rgba(255,120,40,${0.6 * glow}), 0 0 0 2px #4a4e55`;
      raf = requestAnimationFrame(drawTube);
    };

    paint();
    raf = requestAnimationFrame(drawTube);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
