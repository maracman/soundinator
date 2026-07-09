// Ring Modulator — heterodyne sum-and-difference sidebands, modelled on the
// Moog MF-102 Moogerfooger (carrier spanning LFO-through-audio rates, plus an
// onboard drift LFO on the carrier). Contract: docs/EFFECTS_CONTRACT.md.
// DSP: input → modGain, carrier osc → modGain.gain (true 4-quadrant-ish AM
// product), wet-only output. UI: sci-fi laboratory instrument — dark bakelite,
// cream shortwave tuning dial, phosphor X-Y interference scope.

const CSS = `
.fx-ring-mod-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:linear-gradient(168deg,#2e241b 0%,#201812 48%,#150f0a 100%);
  border-radius:10px;border:1px solid #0c0805;position:relative;overflow:hidden;
  box-shadow:inset 0 1px 0 #ffffff14,inset 0 -18px 40px #00000066;
  font-family:"Eurostile","Bank Gothic","Avenir Next","Trebuchet MS",sans-serif;color:#e8dcc0;}
.fx-ring-mod-root *{box-sizing:border-box;}
.fx-ring-mod-head{display:flex;align-items:baseline;gap:10px;padding:9px 14px 4px;flex:0 0 auto;}
.fx-ring-mod-logo{font-size:15px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  color:#efe4c8;text-shadow:0 -1px 0 #000c;}
.fx-ring-mod-sub{font-size:8px;letter-spacing:.28em;text-transform:uppercase;color:#9c8a66;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;min-width:0;}
.fx-ring-mod-lamp{margin-left:auto;align-self:center;width:13px;height:13px;border-radius:50%;flex:0 0 auto;
  background:radial-gradient(circle at 35% 30%,#ffe9b0,#d99a20 55%,#5c3c08);
  border:2px solid #0c0805;box-shadow:0 0 0 2px #3a2d1f,0 0 6px 1px #d99a2066;}
.fx-ring-mod-main{flex:1;display:flex;gap:8px;padding:4px 12px 8px;min-height:0;}
.fx-ring-mod-dialbox{flex:1.35;min-width:0;display:flex;flex-direction:column;align-items:center;min-height:0;}
.fx-ring-mod-dialbox canvas{width:100%;flex:1;min-height:0;display:block;cursor:ns-resize;touch-action:none;}
.fx-ring-mod-scopebox{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;min-height:0;}
.fx-ring-mod-scope{width:100%;flex:1;min-height:0;border-radius:8px;border:2px solid #3a2d1f;
  background:#050a05;box-shadow:inset 0 3px 12px #000e,0 1px 0 #ffffff10;overflow:hidden;}
.fx-ring-mod-scope canvas{width:100%;height:100%;display:block;}
.fx-ring-mod-rail{flex:0 0 84px;display:flex;flex-direction:column;align-items:center;
  justify-content:space-evenly;gap:2px;min-height:0;}
.fx-ring-mod-cell{display:flex;flex-direction:column;align-items:center;gap:3px;}
.fx-ring-mod-knob{width:42px;height:42px;border-radius:50%;cursor:ns-resize;position:relative;touch-action:none;
  background:radial-gradient(circle at 34% 28%,#f7efd8,#d9c99e 62%,#a89468);
  border:3px solid #0c0805;box-shadow:0 3px 6px #000a,inset 0 1px 1px #fff8,0 0 0 1px #3a2d1f;}
.fx-ring-mod-knob::after{content:"";position:absolute;left:50%;top:3px;width:3px;height:15px;
  margin-left:-1.5px;border-radius:2px;background:#2a1e12;transform-origin:1.5px 18px;
  transform:rotate(var(--fx-rot,0deg));}
.fx-ring-mod-label{font-size:8px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#b7a67e;}
.fx-ring-mod-val{font-size:9px;font-family:ui-monospace,Menlo,monospace;color:#ffe9b0;
  background:#120d08;border:1px solid #3a2d1f;border-radius:3px;padding:0 4px;min-width:50px;
  text-align:center;text-shadow:0 0 4px #d99a2088;}
.fx-ring-mod-freqval{font-size:12px;padding:1px 8px;min-width:74px;margin-top:2px;}
.fx-ring-mod-switch{display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;}
.fx-ring-mod-switch span{font-size:8px;font-weight:700;letter-spacing:.14em;color:#7c6c4e;}
.fx-ring-mod-switch span.fx-ring-mod-live{color:#ffe9b0;text-shadow:0 0 5px #d99a2088;}
.fx-ring-mod-lever{width:30px;height:14px;border-radius:7px;background:#120d08;position:relative;
  border:1px solid #3a2d1f;box-shadow:inset 0 2px 4px #000c;}
.fx-ring-mod-lever::after{content:"";position:absolute;top:1px;left:1px;width:10px;height:10px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#f7efd8,#c9b488);box-shadow:0 1px 2px #000a;
  transition:left .12s;}
.fx-ring-mod-switch.fx-ring-mod-on .fx-ring-mod-lever::after{left:17px;}
.fx-ring-mod-presets{display:flex;gap:6px;padding:0 14px 10px;flex-wrap:wrap;flex:0 0 auto;}
.fx-ring-mod-preset{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#e8dcc0;cursor:pointer;
  background:#2a1f15;border:1px solid #4a3a26;border-radius:4px;padding:3px 9px;font-family:inherit;}
.fx-ring-mod-preset:hover{background:#3a2d1f;color:#ffe9b0;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="ring-mod"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "ring-mod";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

const FMIN = 1, FMAX = 4000;
const logPos = (f) => Math.log(f / FMIN) / Math.log(FMAX / FMIN);
const posFreq = (p) => FMIN * Math.pow(FMAX / FMIN, Math.min(1, Math.max(0, p)));
const fmtHz = (f) =>
  f >= 1000 ? `${(f / 1000).toFixed(2)} kHz`
  : f >= 100 ? `${Math.round(f)} Hz`
  : f >= 10 ? `${f.toFixed(1)} Hz`
  : `${f.toFixed(2)} Hz`;

export default {
  id: "ring-mod",
  name: "Ring Modulator",
  category: "Modulation",
  description: "Metallic sum-and-difference sidebands — subtle bell shimmer to full radio-drama robot.",
  defaults: { freq: 520, driftRate: 0.3, driftAmt: 0.12, wave: 0 },
  params: {
    freq:      { label: "Carrier",    min: 1,    max: 4000, step: 0.01, unit: "Hz", curve: "log" },
    driftRate: { label: "Drift Rate", min: 0.05, max: 12,   step: 0.01, unit: "Hz" },
    driftAmt:  { label: "Drift",      min: 0,    max: 1,    step: 0.01, unit: ""   },
    wave:      { label: "Wave",       min: 0,    max: 1,    step: 1,    unit: ""   },
  },
  presets: [
    { name: "Bell Foundry",  params: { freq: 780,  driftRate: 0.15, driftAmt: 0.06, wave: 0 } },
    { name: "Dalek Address", params: { freq: 30,   driftRate: 0.3,  driftAmt: 0,    wave: 1 } },
    { name: "Ghost Signal",  params: { freq: 220,  driftRate: 0.4,  driftAmt: 0.55, wave: 0 } },
    { name: "Sub Rotor",     params: { freq: 7.5,  driftRate: 0.1,  driftAmt: 0.15, wave: 0 } },
    { name: "Sputnik",       params: { freq: 1500, driftRate: 2.8,  driftAmt: 0.35, wave: 0 } },
  ],
  defaultWet: 0.6, // wet-only sidebands; ~60% against dry is the usable sweet spot

  build(ctx) {
    const input = ctx.createGain();
    const mod = ctx.createGain();      // the ring: signal × carrier
    const out = ctx.createGain();
    mod.gain.value = 0;                // audio-rate carrier is the only gain source
    out.gain.value = 1.3;              // sine product loses ~3 dB RMS — make it up

    // two carriers crossfaded → click-free waveform switch
    const sineOsc = ctx.createOscillator();
    const sqOsc = ctx.createOscillator();
    sineOsc.type = "sine";
    sqOsc.type = "square";
    sineOsc.frequency.value = 520;
    sqOsc.frequency.value = 520;
    const sineLvl = ctx.createGain();
    const sqLvl = ctx.createGain();
    sineLvl.gain.value = 1;
    sqLvl.gain.value = 0;

    // MF-102-style drift LFO wobbling the carrier frequency
    const drift = ctx.createOscillator();
    drift.type = "sine";
    drift.frequency.value = 0.3;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 520 * 0.12 * 0.45;

    input.connect(mod);
    mod.connect(out);
    sineOsc.connect(sineLvl);
    sineLvl.connect(mod.gain);
    sqOsc.connect(sqLvl);
    sqLvl.connect(mod.gain);
    drift.connect(driftGain);
    driftGain.connect(sineOsc.frequency);
    driftGain.connect(sqOsc.frequency);

    const t0 = ctx.currentTime;
    sineOsc.start(t0);
    sqOsc.start(t0);
    drift.start(t0);

    return {
      input,
      output: out,
      update(p) {
        const t = ctx.currentTime;
        // setTargetAtTime = exponential approach → zipper-free carrier sweeps
        sineOsc.frequency.setTargetAtTime(p.freq, t, 0.02);
        sqOsc.frequency.setTargetAtTime(p.freq, t, 0.02);
        drift.frequency.setTargetAtTime(p.driftRate, t, 0.02);
        // drift depth scales with the carrier so it stays musical across 1 Hz–4 kHz
        driftGain.gain.setTargetAtTime(p.freq * p.driftAmt * 0.45, t, 0.03);
        const sq = p.wave >= 0.5;
        sineLvl.gain.setTargetAtTime(sq ? 0 : 1, t, 0.015);
        sqLvl.gain.setTargetAtTime(sq ? 0.9 : 0, t, 0.015);
        out.gain.setTargetAtTime(sq ? 1.05 : 1.3, t, 0.02);
      },
      dispose() {
        for (const o of [sineOsc, sqOsc, drift]) { try { o.stop(); } catch {} }
        for (const n of [input, mod, out, sineOsc, sqOsc, sineLvl, sqLvl, drift, driftGain]) {
          try { n.disconnect(); } catch {}
        }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const defaults = this.defaults;
    const root = document.createElement("div");
    root.className = "fx-ring-mod-root";
    root.innerHTML = `
      <div class="fx-ring-mod-head">
        <span class="fx-ring-mod-logo">Heliodyne</span>
        <span class="fx-ring-mod-sub">heterodyne modulator · type hx-4</span>
        <span class="fx-ring-mod-lamp" data-lamp></span>
      </div>
      <div class="fx-ring-mod-main">
        <div class="fx-ring-mod-dialbox">
          <canvas data-dial></canvas>
          <span class="fx-ring-mod-label">${P.freq.label}</span>
          <span class="fx-ring-mod-val fx-ring-mod-freqval" data-val="freq"></span>
        </div>
        <div class="fx-ring-mod-scopebox">
          <div class="fx-ring-mod-scope"><canvas data-scope></canvas></div>
        </div>
        <div class="fx-ring-mod-rail">
          ${["driftRate", "driftAmt"].map((k) => `
            <div class="fx-ring-mod-cell">
              <div class="fx-ring-mod-knob" data-knob="${k}"></div>
              <span class="fx-ring-mod-label">${P[k].label}</span>
              <span class="fx-ring-mod-val" data-val="${k}"></span>
            </div>`).join("")}
          <div class="fx-ring-mod-cell">
            <div class="fx-ring-mod-switch" data-wave>
              <span data-w0>SIN</span>
              <div class="fx-ring-mod-lever"></div>
              <span data-w1>SQR</span>
            </div>
            <span class="fx-ring-mod-label">${P.wave.label}</span>
          </div>
        </div>
      </div>
      ${host.expanded ? `<div class="fx-ring-mod-presets">
        ${this.presets.map((pr, i) => `<button class="fx-ring-mod-preset" data-preset="${i}">${pr.name}</button>`).join("")}
      </div>` : ""}`;
    container.appendChild(root);

    const lamp = root.querySelector("[data-lamp]");
    const dial = root.querySelector("[data-dial]");
    const scope = root.querySelector("[data-scope]");
    const dcx = dial.getContext("2d");
    const scx = scope.getContext("2d");
    const swEl = root.querySelector("[data-wave]");

    const fmt = (k, v) =>
      k === "freq" ? fmtHz(v)
      : k === "driftRate" ? `${v.toFixed(2)} Hz`
      : `${Math.round(v * 100)}%`;

    // ---- shortwave tuning dial ------------------------------------------
    const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // 135° → 405°, like a radio dial
    const drawDial = () => {
      const r = dial.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const d = devicePixelRatio || 1;
      if (dial.width !== Math.round(r.width * d)) dial.width = Math.round(r.width * d);
      if (dial.height !== Math.round(r.height * d)) dial.height = Math.round(r.height * d);
      dcx.setTransform(d, 0, 0, d, 0, 0);
      const w = r.width, h = r.height;
      const cx0 = w / 2, cy0 = h / 2;
      const R = Math.min(w, h) / 2 - 3;
      dcx.clearRect(0, 0, w, h);
      // bezel + cream face
      dcx.beginPath(); dcx.arc(cx0, cy0, R, 0, 7);
      dcx.fillStyle = "#0c0805"; dcx.fill();
      dcx.beginPath(); dcx.arc(cx0, cy0, R - 2.5, 0, 7);
      const face = dcx.createRadialGradient(cx0 - R * 0.3, cy0 - R * 0.35, R * 0.2, cx0, cy0, R);
      face.addColorStop(0, "#f7efd8"); face.addColorStop(1, "#d9c99e");
      dcx.fillStyle = face; dcx.fill();
      // fine graduations on a log scale
      const marks = [1, 2, 3, 5, 7, 10, 20, 30, 50, 70, 100, 200, 300, 500, 700, 1000, 2000, 3000, 4000];
      const labels = { 1: "1", 10: "10", 100: "100", 1000: "1k", 4000: "4k" };
      dcx.strokeStyle = "#4a3a26"; dcx.fillStyle = "#4a3a26";
      dcx.textAlign = "center"; dcx.textBaseline = "middle";
      dcx.font = `700 ${Math.max(7, R * 0.13)}px Trebuchet MS,sans-serif`;
      for (let i = 0; i < 60; i++) { // minor hairlines
        const a = A0 + (i / 59) * SWEEP;
        dcx.lineWidth = 0.6;
        dcx.beginPath();
        dcx.moveTo(cx0 + Math.cos(a) * (R - 6), cy0 + Math.sin(a) * (R - 6));
        dcx.lineTo(cx0 + Math.cos(a) * (R - 11), cy0 + Math.sin(a) * (R - 11));
        dcx.stroke();
      }
      for (const f of marks) {
        const a = A0 + logPos(f) * SWEEP;
        const major = labels[f] !== undefined;
        dcx.lineWidth = major ? 1.8 : 1;
        dcx.beginPath();
        dcx.moveTo(cx0 + Math.cos(a) * (R - 6), cy0 + Math.sin(a) * (R - 6));
        dcx.lineTo(cx0 + Math.cos(a) * (R - (major ? 17 : 13)), cy0 + Math.sin(a) * (R - (major ? 17 : 13)));
        dcx.stroke();
        if (major) dcx.fillText(labels[f], cx0 + Math.cos(a) * (R - 25), cy0 + Math.sin(a) * (R - 25));
      }
      dcx.font = `${Math.max(6, R * 0.1)}px Trebuchet MS,sans-serif`;
      dcx.fillText("CYCLES / SEC", cx0, cy0 + R * 0.45);
      // needle
      const a = A0 + logPos(host.params.freq) * SWEEP;
      dcx.strokeStyle = "#8a2418"; dcx.lineWidth = Math.max(1.5, R * 0.035); dcx.lineCap = "round";
      dcx.beginPath();
      dcx.moveTo(cx0 - Math.cos(a) * R * 0.14, cy0 - Math.sin(a) * R * 0.14);
      dcx.lineTo(cx0 + Math.cos(a) * (R - 14), cy0 + Math.sin(a) * (R - 14));
      dcx.stroke();
      dcx.beginPath(); dcx.arc(cx0, cy0, Math.max(3, R * 0.09), 0, 7);
      dcx.fillStyle = "#2a1e12"; dcx.fill();
      // glass sheen
      dcx.beginPath(); dcx.arc(cx0, cy0, R - 3, Math.PI * 1.05, Math.PI * 1.55);
      dcx.strokeStyle = "#ffffff55"; dcx.lineWidth = 2; dcx.stroke();
    };

    const paint = () => {
      const p = host.params;
      for (const k of ["driftRate", "driftAmt"]) {
        const rot = -135 + 270 * (p[k] - P[k].min) / (P[k].max - P[k].min);
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rot}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
      root.querySelector('[data-val="freq"]').textContent = fmt("freq", p.freq);
      const sq = p.wave >= 0.5;
      swEl.classList.toggle("fx-ring-mod-on", sq);
      swEl.querySelector("[data-w0]").classList.toggle("fx-ring-mod-live", !sq);
      swEl.querySelector("[data-w1]").classList.toggle("fx-ring-mod-live", sq);
      drawDial();
    };

    // ---- interaction -----------------------------------------------------
    const dragKnob = (el, k, toV, fromV) => {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, start = fromV(host.params[k]);
        const move = (ev) => {
          const raw = toV(start + (startY - ev.clientY) / 160);
          const v = Math.min(P[k].max, Math.max(P[k].min, Math.round(raw / P[k].step) * P[k].step));
          host.setParam(k, v);
          paint();
        };
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      });
      el.addEventListener("dblclick", () => { host.setParam(k, defaults[k]); paint(); });
    };
    dragKnob(dial, "freq", posFreq, logPos); // log-space drag on the big dial
    for (const k of ["driftRate", "driftAmt"]) {
      const range = P[k].max - P[k].min;
      dragKnob(root.querySelector(`[data-knob="${k}"]`), k, (u) => P[k].min + u * range, (v) => (v - P[k].min) / range);
    }
    swEl.addEventListener("click", () => {
      host.setParam("wave", host.params.wave >= 0.5 ? 0 : 1);
      paint();
    });
    for (const btn of root.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => {
        const pr = this.presets[+btn.dataset.preset];
        for (const [k, v] of Object.entries(pr.params)) host.setParam(k, v);
        paint();
      });
    }
    paint();

    // ---- phosphor X-Y interference scope ---------------------------------
    const ro = new ResizeObserver(() => {
      const r = scope.getBoundingClientRect(), d = devicePixelRatio || 1;
      scope.width = Math.max(1, r.width * d);
      scope.height = Math.max(1, r.height * d);
      drawDial();
    });
    ro.observe(scope);
    ro.observe(dial);

    let raf = 0, tA = 0, tB = 0, last = performance.now();
    let sig = new Uint8Array(0);
    const draw = (now) => {
      if (!root.isConnected) return;
      const p = host.params;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = scope.width, h = scope.height;
      if (w > 2 && h > 2) {
        scx.setTransform(1, 0, 0, 1, 0, 0);
        scx.fillStyle = "rgba(4,10,5,0.22)"; // phosphor afterglow decay
        scx.fillRect(0, 0, w, h);
        const pos = logPos(p.freq);
        const wob = p.driftAmt * Math.sin(now / 1000 * p.driftRate * 2 * Math.PI);
        const wa = (0.5 + pos * 4.5) * 2 * Math.PI;         // spin speed tracks carrier
        const wb = wa * (1 + pos * 4 + wob * 0.6);          // lobe count tracks carrier, drift bends it
        const cx0 = w / 2, cy0 = h / 2;
        const rx = w * 0.42, ry = h * 0.42;
        const steps = 150;
        scx.lineWidth = Math.max(1, h / 90);
        scx.strokeStyle = "#5cf08a";
        scx.shadowColor = "#5cf08a";
        scx.shadowBlur = Math.max(2, h / 40);
        scx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const x = cx0 + Math.sin(tA + wa * dt * (i / steps)) * rx;
          const y = cy0 + Math.sin(tB + wb * dt * (i / steps) + wob * 1.4) * ry;
          i ? scx.lineTo(x, y) : scx.moveTo(x, y);
        }
        scx.stroke();
        scx.shadowBlur = 0;
        tA = (tA + wa * dt) % (Math.PI * 2000);
        tB = (tB + wb * dt) % (Math.PI * 2000);
      }
      // indicator lamp: signal-reactive when the analyser exists, drift-pulsed otherwise
      let glow;
      if (host.analyser) {
        if (sig.length !== host.analyser.fftSize) sig = new Uint8Array(host.analyser.fftSize);
        host.analyser.getByteTimeDomainData(sig);
        let sum = 0;
        for (let i = 0; i < sig.length; i += 4) { const v = (sig[i] - 128) / 128; sum += v * v; }
        glow = Math.min(1, Math.sqrt(sum / (sig.length / 4)) * 3);
      } else {
        glow = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 1000 * p.driftRate * 2 * Math.PI)) * Math.max(0.25, p.driftAmt);
      }
      lamp.style.boxShadow =
        `0 0 0 2px #3a2d1f, 0 0 ${6 + 10 * glow}px ${1 + 3 * glow}px rgba(217,154,32,${0.3 + 0.55 * glow})`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
