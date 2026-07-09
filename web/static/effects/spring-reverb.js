// Spring Reverb — "Splashtone" twin-coil amp tank. Character effect per
// docs/EFFECTS_CONTRACT.md: mono, offline-safe, wet-only output, procedural
// spring IR (sum of dispersive downward chirp reflections) swapped click-free
// between two convolvers, with an open-chassis animated-spring face.

const CSS = `
.fx-spring-reverb-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:linear-gradient(180deg,#3a3d40 0%,#2b2d30 40%,#212325 100%);
  border-radius:10px;border:1px solid #101112;overflow:hidden;position:relative;
  font-family:'Avenir Next','Helvetica Neue',Arial,sans-serif;color:#c8cdd2;
  box-shadow:inset 0 1px 0 #ffffff22,inset 0 -18px 40px #00000055;}
.fx-spring-reverb-root *{box-sizing:border-box;}
.fx-spring-reverb-root::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(90deg,#ffffff05 0 2px,#0000 2px 7px);}
.fx-spring-reverb-head{display:flex;align-items:baseline;gap:10px;padding:9px 14px 5px;flex:0 0 auto;}
.fx-spring-reverb-logo{font-size:15px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  color:#e8ded0;text-shadow:0 1px 0 #000c,0 0 12px #d8a95522;font-style:italic;}
.fx-spring-reverb-sub{font-size:8px;letter-spacing:.28em;text-transform:uppercase;color:#8d939a;}
.fx-spring-reverb-lamp{margin-left:auto;align-self:center;width:13px;height:13px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ffe9c0,#d8912a 55%,#5c3a0c);
  border:2px solid #17181a;box-shadow:0 0 0 2px #45484c,0 1px 2px #000a;}
.fx-spring-reverb-tank{flex:1 1 auto;min-height:70px;margin:2px 12px;position:relative;
  background:linear-gradient(180deg,#101214 0%,#181b1e 30%,#131518 70%,#0b0c0e 100%);
  border-radius:6px;border:2px solid #4a4e53;
  box-shadow:inset 0 3px 14px #000e,inset 0 -2px 6px #000c,0 1px 0 #ffffff14;}
.fx-spring-reverb-tank canvas{width:100%;height:100%;display:block;}
.fx-spring-reverb-tag{position:absolute;right:7px;top:5px;font-size:7px;letter-spacing:.22em;
  text-transform:uppercase;color:#5c6167;pointer-events:none;}
.fx-spring-reverb-row{flex:0 0 auto;display:flex;align-items:stretch;gap:6px;padding:6px 12px 11px;min-height:0;}
.fx-spring-reverb-ir{flex:0 0 76px;display:flex;flex-direction:column;align-items:center;gap:3px;}
.fx-spring-reverb-irscreen{width:100%;flex:1;min-height:44px;background:#0d0b06;border-radius:4px;
  border:2px solid #4a4e53;box-shadow:inset 0 2px 8px #000d;}
.fx-spring-reverb-irscreen canvas{width:100%;height:100%;display:block;}
.fx-spring-reverb-knobs{flex:1;display:flex;align-items:center;justify-content:space-evenly;min-width:0;}
.fx-spring-reverb-cell{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:54px;}
.fx-spring-reverb-knob{width:46px;height:46px;border-radius:50%;cursor:ns-resize;position:relative;
  background:radial-gradient(circle at 34% 28%,#f2ead8,#cbbc9c 55%,#8f815f 100%);
  border:3px solid #17181a;box-shadow:0 3px 7px #000b,inset 0 1px 1px #fff9,0 0 0 1px #55595e;}
.fx-spring-reverb-knob::after{content:"";position:absolute;left:50%;top:3px;width:4px;height:16px;
  margin-left:-2px;border-radius:2px;background:#2b2416;transform-origin:2px 20px;
  transform:rotate(var(--fx-rot,0deg));}
.fx-spring-reverb-label{font-size:8px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9aa0a6;}
.fx-spring-reverb-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#e6b96a;
  background:#141210;border:1px solid #45484c;border-radius:3px;padding:0 4px;min-width:48px;text-align:center;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="spring-reverb"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "spring-reverb";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// Physical mappings shared by DSP and UI readouts.
// tension 0..1 → flutter round-trip 62 ms (slack) → 30 ms (taut).
const roundTrip = (tension) => 0.062 - 0.032 * tension;
const decayTau = (decay) => decay / 6.91; // -60 dB at `decay` seconds

// Procedural spring IR: a train of reflections at multiples of the round
// trip. Each reflection is an exponentially swept DOWNWARD chirp (high
// frequencies travel faster along the coil, so they arrive first) that
// smears wider on every trip as dispersion accumulates. Band ~200 Hz–5 kHz,
// plus a faint bandpassed wash. Energy-normalised → unity-ish wet loudness.
function renderIR(ctx, p) {
  const sr = ctx.sampleRate;
  const dur = Math.min(p.decay * 1.2 + 0.12, 5.2);
  const n = Math.max(64, Math.ceil(dur * sr));
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const rt = roundTrip(p.tension);
  const tau = decayTau(p.decay);
  const fHi = 2200 + 3000 * p.tone; // 2.2 k (dark) → 5.2 kHz (bright)
  const fLo = 200 + 140 * p.tone;
  const lnr = Math.log(fLo / fHi);
  const nRef = Math.min(Math.floor(dur / rt) + 1, 160);
  for (let k = 0; k < nRef; k++) {
    const t0 = rt * 0.5 + k * rt * (1 + (Math.random() - 0.5) * 0.012);
    const amp = Math.exp(-t0 / tau) * (k % 2 ? -0.92 : 1);
    if (Math.abs(amp) < 0.0008) break;
    const dK = Math.min(0.007 + k * 0.0032, 0.06); // dispersion smear grows
    const bl = dK * sr;
    const i0 = Math.floor(t0 * sr);
    const len = Math.min(Math.ceil(bl), n - i0);
    if (len <= 0) continue;
    const c1 = (2 * Math.PI * fHi * dK) / lnr;
    const ph0 = Math.random() * 2 * Math.PI;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const env = Math.pow(u + 1e-4, 0.22) * (1 - u) * (1 - u);
      const ph = c1 * (Math.exp(lnr * (i / bl)) - 1) + ph0;
      d[i0 + i] += amp * env * Math.sin(ph);
    }
  }
  // faint boingy wash: decaying noise through a cheap SVF bandpass ~1.3 kHz
  let lp = 0, bp = 0;
  const f = 2 * Math.sin((Math.PI * 1300) / sr), q = 0.55;
  for (let i = 0; i < n; i++) {
    const x = (Math.random() * 2 - 1) * 0.05 * Math.exp(-(i / sr) / tau);
    lp += f * bp;
    const hp = x - lp - q * bp;
    bp += f * hp;
    d[i] += bp * 0.35;
  }
  let e = 0;
  for (let i = 0; i < n; i++) e += d[i] * d[i];
  const g = e > 0 ? 1.0 / Math.sqrt(e) : 1;
  for (let i = 0; i < n; i++) d[i] *= g;
  return buf;
}

export default {
  id: "spring-reverb",
  name: "Spring Reverb",
  category: "Character",
  description: "Boingy twin-spring amp tank — dispersive chirps, flutter echoes and surf drip.",
  defaults: { tension: 0.55, decay: 1.8, tone: 0.6, drip: 0.5 },
  params: {
    tension: { label: "Tension", min: 0,   max: 1, step: 0.01, unit: ""  },
    decay:   { label: "Decay",   min: 0.5, max: 4, step: 0.05, unit: "s" },
    tone:    { label: "Tone",    min: 0,   max: 1, step: 0.01, unit: ""  },
    drip:    { label: "Drip",    min: 0,   max: 1, step: 0.01, unit: ""  },
  },
  presets: [
    { name: "Blackface Splash", params: { tension: 0.55, decay: 1.8, tone: 0.6,  drip: 0.5  } },
    { name: "Surf Dripper",     params: { tension: 0.35, decay: 2.6, tone: 0.8,  drip: 0.9  } },
    { name: "Tight Tank",       params: { tension: 0.88, decay: 0.8, tone: 0.5,  drip: 0.25 } },
    { name: "Rusty Basement",   params: { tension: 0.15, decay: 3.4, tone: 0.22, drip: 0.4  } },
    { name: "Cavern Boing",     params: { tension: 0.5,  decay: 4,   tone: 0.45, drip: 0.65 } },
  ],
  defaultWet: 0.35,

  build(ctx) {
    const offline = typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext;
    const input = ctx.createGain();
    const direct = ctx.createGain();
    const dripBP = ctx.createBiquadFilter(); // pre "drip" chirp-band emphasis
    dripBP.type = "bandpass";
    dripBP.frequency.value = 2600;
    dripBP.Q.value = 1.4;
    const dripGain = ctx.createGain();
    const send = ctx.createGain();
    const out = ctx.createGain();
    const convA = ctx.createConvolver();
    const convB = ctx.createConvolver();
    convA.normalize = false;
    convB.normalize = false;
    const gA = ctx.createGain(), gB = ctx.createGain();
    input.connect(direct); direct.connect(send);
    input.connect(dripBP); dripBP.connect(dripGain); dripGain.connect(send);
    send.connect(convA); convA.connect(gA); gA.connect(out);
    send.connect(convB); convB.connect(gB); gB.connect(out);

    const dft = this.defaults;
    dripGain.gain.value = dft.drip * 1.8;
    send.gain.value = 1 / (1 + dft.drip * 0.9);
    gA.gain.value = 1;
    gB.gain.value = 0;
    convA.buffer = renderIR(ctx, dft);

    let active = 0; // which convolver is audible
    let irTimer = 0;
    let ir = { tension: dft.tension, decay: dft.decay, tone: dft.tone };

    const swapIR = (p) => {
      // build the new IR on the IDLE convolver, then equal-ramp crossfade —
      // the running tail fades over ~100 ms, never a click.
      const idleConv = active === 0 ? convB : convA;
      const idleGain = active === 0 ? gB : gA;
      const liveGain = active === 0 ? gA : gB;
      idleConv.buffer = renderIR(ctx, p);
      const t = ctx.currentTime;
      liveGain.gain.setTargetAtTime(0, t, 0.035);
      idleGain.gain.setTargetAtTime(1, t, 0.035);
      active ^= 1;
    };

    return {
      input,
      output: out,
      update(p) {
        const t = ctx.currentTime;
        dripGain.gain.setTargetAtTime(p.drip * 1.8, t, 0.02);
        send.gain.setTargetAtTime(1 / (1 + p.drip * 0.9), t, 0.02);
        if (
          Math.abs(p.tension - ir.tension) > 1e-3 ||
          Math.abs(p.decay - ir.decay) > 1e-3 ||
          Math.abs(p.tone - ir.tone) > 1e-3
        ) {
          ir = { tension: p.tension, decay: p.decay, tone: p.tone };
          if (offline) {
            // offline mixdown: apply synchronously, no timers
            (active === 0 ? convA : convB).buffer = renderIR(ctx, p);
          } else {
            clearTimeout(irTimer);
            const snap = { tension: p.tension, decay: p.decay, tone: p.tone };
            irTimer = setTimeout(() => swapIR(snap), 80); // debounce regen
          }
        }
      },
      dispose() {
        clearTimeout(irTimer);
        for (const n of [input, direct, dripBP, dripGain, send, convA, convB, gA, gB, out]) {
          try { n.disconnect(); } catch {}
        }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const KEYS = Object.keys(P);
    const root = document.createElement("div");
    root.className = "fx-spring-reverb-root";
    root.innerHTML = `
      <div class="fx-spring-reverb-head">
        <span class="fx-spring-reverb-logo">Splashtone</span>
        <span class="fx-spring-reverb-sub">twin-coil tank · type 2S</span>
        <span class="fx-spring-reverb-lamp" data-lamp></span>
      </div>
      <div class="fx-spring-reverb-tank">
        <canvas data-tank></canvas>
        <span class="fx-spring-reverb-tag">accutronics-grade coils</span>
      </div>
      <div class="fx-spring-reverb-row">
        <div class="fx-spring-reverb-ir">
          <div class="fx-spring-reverb-irscreen"><canvas data-ir></canvas></div>
          <span class="fx-spring-reverb-label">Tank IR</span>
        </div>
        <div class="fx-spring-reverb-knobs">
          ${KEYS.map((k) => `
            <div class="fx-spring-reverb-cell">
              <div class="fx-spring-reverb-knob" data-knob="${k}"></div>
              <span class="fx-spring-reverb-label">${P[k].label}</span>
              <span class="fx-spring-reverb-val" data-val="${k}"></span>
            </div>`).join("")}
        </div>
      </div>`;
    container.appendChild(root);

    const lamp = root.querySelector("[data-lamp]");
    const tankCv = root.querySelector("[data-tank]");
    const irCv = root.querySelector("[data-ir]");
    const tcx = tankCv.getContext("2d");
    const icx = irCv.getContext("2d");

    const fmt = (k, v) => (k === "decay" ? `${v.toFixed(2)} s` : `${Math.round(v * 100)}%`);
    const rotFor = (k, v) => -135 + (270 * (v - P[k].min)) / (P[k].max - P[k].min);
    const paint = () => {
      const p = host.params;
      for (const k of KEYS) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${rotFor(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
    };
    paint();

    for (const k of KEYS) {
      const el = root.querySelector(`[data-knob="${k}"]`);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, startV = host.params[k];
        const range = P[k].max - P[k].min;
        const move = (ev) => {
          let v = startV + ((startY - ev.clientY) / 140) * range;
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

    // dpr-aware canvases
    const ro = new ResizeObserver(() => {
      for (const cv of [tankCv, irCv]) {
        const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
        cv.width = Math.max(1, r.width * d);
        cv.height = Math.max(1, r.height * d);
      }
    });
    ro.observe(tankCv);
    ro.observe(irCv);

    // spring wobble intensity: analyser signal level when available,
    // otherwise a decaying ripple kicked whenever a param moves.
    let raf = 0;
    let level = 0, ripple = 0.9;
    let lastP = { ...host.params };
    const aBuf = host.analyser ? new Uint8Array(host.analyser.fftSize || 2048) : null;
    const t0 = performance.now();

    const drawTank = (now) => {
      const p = host.params;
      const d = devicePixelRatio || 1;
      const w = tankCv.width / d, h = tankCv.height / d;
      if (w < 4 || h < 4) return;
      tcx.setTransform(d, 0, 0, d, 0, 0);
      tcx.clearRect(0, 0, w, h);
      const time = (now - t0) / 1000;
      // intensity source
      if (host.analyser && aBuf) {
        host.analyser.getByteTimeDomainData(aBuf);
        let s = 0;
        for (let i = 0; i < aBuf.length; i += 4) { const v = (aBuf[i] - 128) / 128; s += v * v; }
        const rms = Math.sqrt(s / (aBuf.length / 4));
        level += (Math.min(1, rms * 4) - level) * (rms * 4 > level ? 0.4 : 0.045);
      } else {
        ripple *= 0.975;
        level = ripple;
      }
      const inten = Math.min(1, level);
      lamp.style.boxShadow =
        `0 0 ${10 * inten + 2}px ${4 * inten}px rgba(232,164,60,${0.5 * inten + 0.08}), 0 0 0 2px #45484c`;
      const x0 = w * 0.055, x1 = w * 0.945;
      // tank rails
      tcx.strokeStyle = "#3c4045";
      tcx.lineWidth = 2;
      tcx.beginPath(); tcx.moveTo(x0 - 6, h * 0.14); tcx.lineTo(x1 + 6, h * 0.14);
      tcx.moveTo(x0 - 6, h * 0.88); tcx.lineTo(x1 + 6, h * 0.88); tcx.stroke();
      const coilFreq = (0.42 + p.tension * 0.34);      // taut spring = denser coil look
      const coilAmp = Math.min(h * 0.085, 9);
      for (let s = 0; s < 2; s++) {
        const yc = h * (0.36 + 0.32 * s);
        const wA = (h * 0.11) * inten * (s ? 0.8 : 1);
        // anchor tabs
        tcx.fillStyle = "#565b61";
        tcx.fillRect(x0 - 7, yc - 7, 7, 14);
        tcx.fillRect(x1, yc - 7, 7, 14);
        tcx.strokeStyle = s ? "rgba(176,188,198,0.85)" : "rgba(198,208,218,0.92)";
        tcx.lineWidth = Math.max(1.1, h / 60);
        tcx.beginPath();
        const step = Math.max(1.5, (x1 - x0) / 360);
        for (let x = x0; x <= x1; x += step) {
          const q = (x - x0) / (x1 - x0);
          const stand = Math.sin(q * Math.PI); // pinned at both anchors
          const wob =
            Math.sin(q * Math.PI * 3 + time * (6.5 + s * 1.7)) * stand * wA +
            Math.sin(q * Math.PI * 7 - time * (10.5 - s * 2)) * stand * wA * 0.45;
          const y = yc + wob + Math.sin(x * coilFreq + s * 2.1) * coilAmp;
          x === x0 ? tcx.moveTo(x, y) : tcx.lineTo(x, y);
        }
        tcx.stroke();
        // glint pass
        tcx.strokeStyle = `rgba(255,255,255,${0.10 + 0.25 * inten})`;
        tcx.lineWidth = 0.7;
        tcx.beginPath();
        for (let x = x0; x <= x1; x += step * 2) {
          const q = (x - x0) / (x1 - x0);
          const stand = Math.sin(q * Math.PI);
          const wob = Math.sin(q * Math.PI * 3 + time * (6.5 + s * 1.7)) * stand * wA;
          const y = yc - 1.5 + wob + Math.sin(x * coilFreq + s * 2.1) * coilAmp;
          x === x0 ? tcx.moveTo(x, y) : tcx.lineTo(x, y);
        }
        tcx.stroke();
      }
    };

    const drawIR = () => {
      const p = host.params;
      const d = devicePixelRatio || 1;
      const w = irCv.width / d, h = irCv.height / d;
      if (w < 4 || h < 4) return;
      icx.setTransform(d, 0, 0, d, 0, 0);
      icx.clearRect(0, 0, w, h);
      const rt = roundTrip(p.tension), tau = decayTau(p.decay);
      const win = p.decay * 1.15 + 0.1;
      // flutter-echo spikes at round-trip multiples
      icx.strokeStyle = "#e6a83c";
      icx.lineWidth = 1;
      icx.beginPath();
      for (let t = rt * 0.5; t < win; t += rt) {
        const x = (t / win) * (w - 4) + 2;
        const hh = Math.exp(-t / tau) * (h - 6);
        icx.moveTo(x, h - 2);
        icx.lineTo(x, h - 2 - hh);
      }
      icx.stroke();
      // decay envelope
      icx.strokeStyle = "rgba(240,196,120,0.8)";
      icx.lineWidth = 1.2;
      icx.beginPath();
      for (let x = 2; x < w - 2; x += 2) {
        const t = ((x - 2) / (w - 4)) * win;
        const y = h - 2 - Math.exp(-t / tau) * (h - 6);
        x === 2 ? icx.moveTo(x, y) : icx.lineTo(x, y);
      }
      icx.stroke();
    };

    const frame = (now) => {
      if (!root.isConnected) return;
      const p = host.params;
      for (const k of KEYS) {
        if (p[k] !== lastP[k]) { ripple = 1; lastP = { ...p }; paint(); break; }
      }
      drawTank(now);
      drawIR();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
