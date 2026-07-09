// Vinyl — worn-record character unit. Effects-contract module
// (docs/EFFECTS_CONTRACT.md): mono DSP, native nodes only, offline-safe,
// self-styled turntable face with parameter-driven visual feedback.
//
// Recipe (after iZotope Vinyl / SketchCassette): wow = slow pitch drift at
// the platter rotation rate (33⅓ rpm ≈ 0.556 Hz) via LFO→DelayNode, up to
// ±2.2 ms; flutter = shallow 7.4 Hz motor jitter, up to ±0.45 ms; crackle =
// looping procedural buffer of sparse damped noise bursts (ticks + pops);
// hiss = filtered noise bed that rises with age; age = HP and LP shelving
// in toward the midrange (20→600 Hz, 16 k→2.2 k, log sweeps).

const CSS = `
.fx-vinyl-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:repeating-linear-gradient(93deg,rgba(0,0,0,.13) 0 2px,transparent 2px 9px),
    linear-gradient(170deg,#4a3220 0%,#2c1d11 60%,#211409 100%);
  border-radius:10px;border:1px solid #1a100a;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 -16px 34px rgba(0,0,0,.35);
  font-family:'Avenir Next','Trebuchet MS',sans-serif;color:#e7dcc3;overflow:hidden;position:relative;}
.fx-vinyl-root *{box-sizing:border-box;}
.fx-vinyl-head{display:flex;align-items:baseline;gap:10px;padding:9px 14px 3px;flex:0 0 auto;}
.fx-vinyl-logo{font-size:15px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;
  color:#e7dcc3;text-shadow:0 1px 0 rgba(0,0,0,.5);}
.fx-vinyl-sub{font-size:8.5px;letter-spacing:.28em;text-transform:uppercase;color:#a08b62;}
.fx-vinyl-lamp{margin-left:auto;align-self:center;width:13px;height:13px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ffe9b8,#c07818 55%,#5c3608);
  border:2px solid #241708;box-shadow:0 0 0 2px #3a281655,0 1px 2px rgba(0,0,0,.4);}
.fx-vinyl-deck{flex:1 1 auto;min-height:0;margin:2px 12px;position:relative;}
.fx-vinyl-deck canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.fx-vinyl-wear{display:flex;align-items:center;gap:8px;margin:2px 14px 0;flex:0 0 auto;}
.fx-vinyl-wear-label{font-size:8px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#a08b62;}
.fx-vinyl-wear-track{flex:1;height:7px;border-radius:4px;background:#140d06;border:1px solid #171009;
  box-shadow:inset 0 1px 3px rgba(0,0,0,.7);overflow:hidden;}
.fx-vinyl-wear-fill{height:100%;width:0%;border-radius:4px 0 0 4px;
  background:linear-gradient(90deg,#7d9a5a,#c9a24a 55%,#b4502e);}
.fx-vinyl-presets{display:flex;gap:6px;padding:5px 14px 0;flex-wrap:wrap;flex:0 0 auto;}
.fx-vinyl-preset{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#e7dcc3;
  background:rgba(0,0,0,.22);border:1px solid rgba(160,139,98,.4);border-radius:4px;
  padding:3px 8px;cursor:pointer;font-family:inherit;}
.fx-vinyl-preset:hover{background:rgba(160,139,98,.22);}
.fx-vinyl-knobs{flex:0 0 auto;display:flex;align-items:center;justify-content:space-evenly;
  padding:5px 8px 11px;}
.fx-vinyl-cell{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:58px;}
.fx-vinyl-knob{width:46px;height:46px;border-radius:50%;cursor:ns-resize;position:relative;
  background:radial-gradient(circle at 34% 28%,#f0ede6,#b9b4a8 45%,#6f6a5e 78%,#4c473d);
  border:2px solid #241708;box-shadow:0 3px 7px rgba(0,0,0,.55),inset 0 1px 1px rgba(255,255,255,.5);}
.fx-vinyl-knob::after{content:"";position:absolute;left:50%;top:3px;width:3px;height:16px;
  margin-left:-1.5px;border-radius:2px;background:#241708;transform-origin:1.5px 20px;
  transform:rotate(var(--fx-rot,0deg));}
.fx-vinyl-label{font-size:8.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#c8b27f;}
.fx-vinyl-val{font-size:9.5px;font-family:ui-monospace,Menlo,monospace;color:#e7dcc3;
  background:rgba(0,0,0,.28);border:1px solid rgba(160,139,98,.33);border-radius:3px;
  padding:0 5px;min-width:56px;text-align:center;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="vinyl"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "vinyl";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// ~4 s looping bed of sparse damped-noise bursts: many small ticks, a few
// fat pops (amplitudes weighted toward quiet, like real dust). Long enough
// that the loop point is not audible as a pattern.
function makeCrackleBuffer(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 4);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const burst = (amp, tauSec) => {
    const pos = Math.floor(Math.random() * (len - sr * 0.03));
    const tau = tauSec * sr;
    const n = Math.max(3, Math.floor(tau * 5));
    for (let j = 0; j < n && pos + j < len; j++) {
      d[pos + j] += amp * Math.exp(-j / tau) * (Math.random() * 2 - 1);
    }
  };
  for (let i = 0; i < 220; i++) burst(0.05 + Math.pow(Math.random(), 2) * 0.3, 0.00015 + Math.random() * 0.0009);
  for (let i = 0; i < 14; i++) burst(0.45 + Math.random() * 0.55, 0.001 + Math.random() * 0.003);
  let pk = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
  if (pk > 0) { const g = 1 / pk; for (let i = 0; i < len; i++) d[i] *= g; }
  return buf;
}

function makeHissBuffer(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export default {
  id: "vinyl",
  name: "Vinyl",
  category: "Character",
  description: "Worn-record nostalgia — wow, flutter, dust crackle, hiss and closing bandwidth.",
  defaults: { wow: 0.3, flutter: 0.2, crackle: 0.35, age: 0.3 },
  params: {
    wow:     { label: "Wow",     min: 0, max: 1, step: 0.01, unit: "" },
    flutter: { label: "Flutter", min: 0, max: 1, step: 0.01, unit: "" },
    crackle: { label: "Crackle", min: 0, max: 1, step: 0.01, unit: "" },
    age:     { label: "Age",     min: 0, max: 1, step: 0.01, unit: "" },
  },
  presets: [
    { name: "Fresh Pressing", params: { wow: 0.06, flutter: 0.08, crackle: 0.1,  age: 0.08 } },
    { name: "Dusty Groove",   params: { wow: 0.3,  flutter: 0.2,  crackle: 0.5,  age: 0.35 } },
    { name: "Attic Find",     params: { wow: 0.55, flutter: 0.4,  crackle: 0.8,  age: 0.7  } },
    { name: "Gramophone 78",  params: { wow: 0.35, flutter: 0.3,  crackle: 0.9,  age: 1    } },
    { name: "Warped 45",      params: { wow: 1,    flutter: 0.55, crackle: 0.3,  age: 0.25 } },
  ],

  build(ctx) {
    const t0 = ctx.currentTime;
    const input = ctx.createGain();
    const out = ctx.createGain();

    // wow + flutter: one short delay line, two LFOs modulating delayTime.
    // Base 4 ms; wow swings up to ±2.2 ms at the 33⅓ rpm rotation rate,
    // flutter up to ±0.45 ms at 7.4 Hz (idler/motor jitter).
    const dly = ctx.createDelay(0.05);
    dly.delayTime.value = 0.004;
    const wowLfo = ctx.createOscillator();
    wowLfo.type = "sine";
    wowLfo.frequency.value = 0.556; // 33 1/3 rpm once-per-rev
    const wowAmt = ctx.createGain();
    wowAmt.gain.value = 0;
    const flLfo = ctx.createOscillator();
    flLfo.type = "sine";
    flLfo.frequency.value = 7.4;
    const flAmt = ctx.createGain();
    flAmt.gain.value = 0;
    wowLfo.connect(wowAmt);
    wowAmt.connect(dly.delayTime);
    flLfo.connect(flAmt);
    flAmt.connect(dly.delayTime);

    // age: HP and LP close in together (log sweeps stay musical end-to-end)
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 20; hp.Q.value = 0.71;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 16000; lp.Q.value = 0.71;
    input.connect(dly); dly.connect(hp); hp.connect(lp); lp.connect(out);

    // crackle: looping procedural tick/pop bed, band-shaped so it sits like
    // surface noise (HP keeps thumps out, LP takes the digital edge off)
    const crk = ctx.createBufferSource();
    crk.buffer = makeCrackleBuffer(ctx);
    crk.loop = true;
    const crkHp = ctx.createBiquadFilter();
    crkHp.type = "highpass"; crkHp.frequency.value = 350; crkHp.Q.value = 0.5;
    const crkLp = ctx.createBiquadFilter();
    crkLp.type = "lowpass"; crkLp.frequency.value = 8500; crkLp.Q.value = 0.5;
    const crkGain = ctx.createGain();
    crkGain.gain.value = 0;
    crk.connect(crkHp); crkHp.connect(crkLp); crkLp.connect(crkGain); crkGain.connect(out);

    // hiss: dull noise bed, rises with age (subtle even at max)
    const hiss = ctx.createBufferSource();
    hiss.buffer = makeHissBuffer(ctx);
    hiss.loop = true;
    const hissLp = ctx.createBiquadFilter();
    hissLp.type = "lowpass"; hissLp.frequency.value = 6000; hissLp.Q.value = 0.5;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hiss.connect(hissLp); hissLp.connect(hissGain); hissGain.connect(out);

    wowLfo.start(t0); flLfo.start(t0); crk.start(t0); hiss.start(t0);

    const nodes = [input, out, dly, wowLfo, wowAmt, flLfo, flAmt, hp, lp,
      crk, crkHp, crkLp, crkGain, hiss, hissLp, hissGain];
    return {
      input,
      output: out,
      update(p) {
        const t = ctx.currentTime;
        wowAmt.gain.setTargetAtTime(p.wow * 0.0022, t, 0.02);
        flAmt.gain.setTargetAtTime(p.flutter * 0.00045, t, 0.02);
        hp.frequency.setTargetAtTime(20 * Math.pow(30, p.age), t, 0.02);       // 20 → 600 Hz
        lp.frequency.setTargetAtTime(16000 * Math.pow(0.1375, p.age), t, 0.02); // 16 k → 2.2 k
        crkGain.gain.setTargetAtTime(Math.pow(p.crackle, 1.6) * 0.22, t, 0.02); // ticks peak ≈ -13 dB at max
        hissGain.gain.setTargetAtTime(p.age * 0.014 + p.crackle * 0.004, t, 0.02);
      },
      dispose() {
        for (const s of [wowLfo, flLfo, crk, hiss]) { try { s.stop(); } catch {} }
        for (const n of nodes) { try { n.disconnect(); } catch {} }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const defaults = this.defaults;
    const presets = this.presets;
    const root = document.createElement("div");
    root.className = "fx-vinyl-root";
    root.innerHTML = `
      <div class="fx-vinyl-head">
        <span class="fx-vinyl-logo">Dustone</span>
        <span class="fx-vinyl-sub">rt-33 · idler drive</span>
        <span class="fx-vinyl-lamp" data-lamp></span>
      </div>
      <div class="fx-vinyl-deck"><canvas></canvas></div>
      <div class="fx-vinyl-wear">
        <span class="fx-vinyl-wear-label">Groove wear</span>
        <span class="fx-vinyl-wear-track"><span class="fx-vinyl-wear-fill" data-wear></span></span>
      </div>
      ${host.expanded ? `<div class="fx-vinyl-presets">
        ${presets.map((pr, i) => `<button class="fx-vinyl-preset" data-preset="${i}">${pr.name}</button>`).join("")}
      </div>` : ""}
      <div class="fx-vinyl-knobs">
        ${Object.keys(P).map((k) => `
          <div class="fx-vinyl-cell">
            <div class="fx-vinyl-knob" data-knob="${k}"></div>
            <span class="fx-vinyl-label">${P[k].label}</span>
            <span class="fx-vinyl-val" data-val="${k}"></span>
          </div>`).join("")}
      </div>`;
    container.appendChild(root);

    const lamp = root.querySelector("[data-lamp]");
    const wearFill = root.querySelector("[data-wear]");
    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");

    const fmt = (k, v) => {
      if (k === "wow") return `±${(v * 2.2).toFixed(2)}ms`;
      if (k === "flutter") return `±${(v * 0.45).toFixed(2)}ms`;
      return `${Math.round(v * 100)}%`;
    };
    const rotFor = (k, v) => -135 + 270 * (v - P[k].min) / (P[k].max - P[k].min);
    const paint = () => {
      const p = host.params;
      for (const k of Object.keys(P)) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rotFor(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
      wearFill.style.width = `${Math.round(p.age * 100)}%`;
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
      el.addEventListener("dblclick", () => { host.setParam(k, defaults[k]); paint(); });
    }

    // preset buttons (expanded view only)
    for (const btn of root.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => {
        const pr = presets[+btn.dataset.preset];
        for (const [k, v] of Object.entries(pr.params)) host.setParam(k, v);
        paint();
      });
    }

    // ---- turntable scene -------------------------------------------------
    // Record surface (grooves, scuffs, label) is cached on an offscreen
    // canvas and rotated each frame at a constant visual 33⅓ rpm.
    const recCan = document.createElement("canvas");
    const recCtx = recCan.getContext("2d");
    let recR = 0;
    const buildRecord = (R) => {
      recR = R;
      const s = Math.ceil(R * 2) + 4;
      recCan.width = recCan.height = s;
      const g = recCtx;
      const c = s / 2;
      g.clearRect(0, 0, s, s);
      g.fillStyle = "#14110f";
      g.beginPath(); g.arc(c, c, R, 0, 7); g.fill();
      // groove rings
      const step = Math.max(1.5, R * 0.014);
      for (let r = R * 0.36; r < R * 0.965; r += step) {
        g.strokeStyle = `rgba(255,255,255,${(0.018 + Math.random() * 0.028).toFixed(3)})`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke();
      }
      // scuffs — arcs that make the rotation readable
      for (let i = 0; i < 6; i++) {
        const r = R * (0.4 + Math.random() * 0.52);
        const a0 = Math.random() * Math.PI * 2;
        g.strokeStyle = `rgba(255,255,255,${(0.04 + Math.random() * 0.05).toFixed(3)})`;
        g.lineWidth = Math.max(1, R * 0.006);
        g.beginPath(); g.arc(c, c, r, a0, a0 + 0.25 + Math.random() * 0.8); g.stroke();
      }
      // label
      g.fillStyle = "#b0562b";
      g.beginPath(); g.arc(c, c, R * 0.31, 0, 7); g.fill();
      g.strokeStyle = "#8c3f1d"; g.lineWidth = Math.max(1, R * 0.01);
      g.beginPath(); g.arc(c, c, R * 0.31, 0, 7); g.stroke();
      // label "text" lines + alignment dot (rotation cue)
      g.fillStyle = "rgba(40,20,8,0.65)";
      for (let i = 0; i < 3; i++) {
        g.fillRect(c - R * 0.12, c + R * (0.08 + i * 0.05), R * (0.24 - i * 0.06), Math.max(1, R * 0.014));
      }
      g.fillStyle = "#efe3c8";
      g.beginPath(); g.arc(c, c - R * 0.22, Math.max(1.5, R * 0.024), 0, 7); g.fill();
      // spindle hole
      g.fillStyle = "#cfc9bd";
      g.beginPath(); g.arc(c, c, Math.max(2, R * 0.024), 0, 7); g.fill();
    };

    // dust specks: count scales with crackle density, each twinkles
    const specks = Array.from({ length: 90 }, () => ({
      fr: 0.36 + Math.random() * 0.56,
      ang: Math.random() * Math.PI * 2,
      fs: 3 + Math.random() * 11,
      ph: Math.random() * Math.PI * 2,
      sz: 0.5 + Math.random(),
    }));

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * d));
      canvas.height = Math.max(1, Math.round(r.height * d));
      recR = 0; // force record rebuild at new size
    });
    ro.observe(canvas);

    let raf = 0;
    let armCur = -1;   // eased stylus radius fraction
    let lampGlow = 0;
    let anaBuf = null;
    let lastSig = "";
    const tStart = performance.now();

    const draw = () => {
      if (!root.isConnected) return;
      const p = host.params;
      const sig = `${p.wow}|${p.flutter}|${p.crackle}|${p.age}`;
      if (sig !== lastSig) { lastSig = sig; paint(); }

      const w = canvas.width, h = canvas.height;
      const t = (performance.now() - tStart) / 1000;
      cx.clearRect(0, 0, w, h);

      const pcx = w * 0.42, pcy = h * 0.5;
      const R = Math.min(w * 0.36, h * 0.44);
      if (Math.abs(R - recR) > 1) buildRecord(R);

      // wow/flutter make the platter visibly drift off-centre
      const wob = Math.sin(t * 2 * Math.PI * 0.556) * p.wow * R * 0.012
                + Math.sin(t * 2 * Math.PI * 7.4) * p.flutter * R * 0.003;
      const ox = pcx + wob, oy = pcy;
      const rot = t * 0.5556 * 2 * Math.PI; // 33 1/3 rpm, constant

      // platter + strobe dots
      cx.fillStyle = "#2a2a2e";
      cx.beginPath(); cx.arc(ox, oy, R * 1.07, 0, 7); cx.fill();
      cx.strokeStyle = "#4a4a50"; cx.lineWidth = Math.max(1, R * 0.02);
      cx.beginPath(); cx.arc(ox, oy, R * 1.07, 0, 7); cx.stroke();
      cx.fillStyle = "#8f8f96";
      for (let i = 0; i < 60; i++) {
        const a = rot + (i / 60) * Math.PI * 2;
        cx.beginPath();
        cx.arc(ox + Math.cos(a) * R * 1.035, oy + Math.sin(a) * R * 1.035, Math.max(1, R * 0.011), 0, 7);
        cx.fill();
      }

      // record (cached surface, rotating)
      cx.save();
      cx.translate(ox, oy);
      cx.rotate(rot);
      cx.drawImage(recCan, -recCan.width / 2, -recCan.height / 2);
      cx.restore();

      // groove-wear band on the record: grey worn ring from the outer edge
      // in to wherever the stylus has chewed to
      const rsFrac = 0.93 - p.age * 0.55;
      if (p.age > 0.02) {
        const mid = (0.93 + rsFrac) / 2, bw = (0.93 - rsFrac) * R;
        cx.strokeStyle = `rgba(205,200,188,${(0.04 + p.age * 0.1).toFixed(3)})`;
        cx.lineWidth = Math.max(1, bw);
        cx.beginPath(); cx.arc(ox, oy, mid * R, 0, 7); cx.stroke();
      }

      // static sheen (light stays put while the grooves move under it)
      cx.strokeStyle = "rgba(255,255,255,0.05)";
      cx.lineWidth = R * 0.5;
      cx.beginPath(); cx.arc(ox, oy, R * 0.66, -2.3, -1.4); cx.stroke();
      cx.strokeStyle = "rgba(255,255,255,0.03)";
      cx.beginPath(); cx.arc(ox, oy, R * 0.66, 0.7, 1.5); cx.stroke();

      // dust specks: density follows crackle, each flickers
      const count = Math.round(p.crackle * specks.length);
      for (let i = 0; i < count; i++) {
        const s = specks[i];
        const gate = (Math.sin(t * s.fs + s.ph) + 1) / 2;
        if (gate < 0.5) continue;
        const a = s.ang + rot;
        cx.fillStyle = `rgba(235,228,210,${((gate - 0.5) * 2 * 0.75).toFixed(3)})`;
        cx.beginPath();
        cx.arc(ox + Math.cos(a) * s.fr * R, oy + Math.sin(a) * s.fr * R,
          Math.max(0.6, s.sz * R * 0.012), 0, 7);
        cx.fill();
      }

      // tonearm: pivot top-right, stylus radius tracks the age knob
      const px = pcx + R * 1.28, py = pcy - R * 0.98;
      if (armCur < 0) armCur = rsFrac;
      armCur += (rsFrac - armCur) * 0.08;
      const dx = px - pcx, dy = py - pcy;
      const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl;
      const sx = pcx + ux * armCur * R, sy = pcy + uy * armCur * R;
      // counterweight behind the pivot
      cx.strokeStyle = "#b9b4a8"; cx.lineWidth = Math.max(2, R * 0.045);
      cx.lineCap = "round";
      cx.beginPath(); cx.moveTo(px, py); cx.lineTo(px + (px - sx) * 0.16, py + (py - sy) * 0.16); cx.stroke();
      cx.fillStyle = "#3a3a3e";
      cx.beginPath(); cx.arc(px + (px - sx) * 0.16, py + (py - sy) * 0.16, Math.max(3, R * 0.06), 0, 7); cx.fill();
      // arm tube
      cx.strokeStyle = "#cfc9bd"; cx.lineWidth = Math.max(1.5, R * 0.03);
      cx.beginPath(); cx.moveTo(px, py); cx.lineTo(sx, sy); cx.stroke();
      // pivot base
      cx.fillStyle = "#55555c";
      cx.beginPath(); cx.arc(px, py, Math.max(3.5, R * 0.075), 0, 7); cx.fill();
      cx.fillStyle = "#8f8f96";
      cx.beginPath(); cx.arc(px, py, Math.max(2, R * 0.04), 0, 7); cx.fill();
      // headshell + stylus
      cx.save();
      cx.translate(sx, sy);
      cx.rotate(Math.atan2(sy - py, sx - px));
      cx.fillStyle = "#242428";
      cx.fillRect(-R * 0.02, -R * 0.028, R * 0.11, R * 0.056);
      cx.restore();
      cx.fillStyle = "#c8452e";
      cx.beginPath(); cx.arc(sx, sy, Math.max(1.5, R * 0.02), 0, 7); cx.fill();

      // jewel lamp: signal-reactive when the host analyser exists
      if (host.analyser) {
        if (!anaBuf || anaBuf.length !== host.analyser.fftSize) anaBuf = new Uint8Array(host.analyser.fftSize);
        host.analyser.getByteTimeDomainData(anaBuf);
        let pk = 0;
        for (let i = 0; i < anaBuf.length; i += 8) {
          const v = Math.abs(anaBuf[i] - 128) / 128;
          if (v > pk) pk = v;
        }
        lampGlow += (pk - lampGlow) * 0.25;
        const gl = 0.25 + lampGlow * 0.75;
        lamp.style.boxShadow = `0 0 ${9 * gl}px ${3 * gl}px rgba(230,150,40,${(0.5 * gl).toFixed(3)}), 0 0 0 2px #3a281655`;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
