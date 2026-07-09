// Sculpt EQ — musical 4-band console/program equalizer in the lineage of the
// Pultec EQP-1A / API 550 / Neve 1073: low cut, low shelf, two sculpting mids,
// high shelf. Mono chain of BiquadFilterNodes, offline-safe, click-free
// updates. UI is a fictional "Vanderlyn" steel-faceplate unit with cream
// chicken-head knobs and a chart-paper response window computed analytically
// from RBJ biquad cookbook math (no audio-node access needed).

const CSS = `
.fx-sculpt-eq-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  position:relative;overflow:hidden;container-type:size;border-radius:10px;border:1px solid #767c82;
  background:
    repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 1px,rgba(0,0,0,0) 1px 3px),
    linear-gradient(180deg,#dfe1e4 0%,#c6c9cd 48%,#aeb2b7 100%);
  box-shadow:inset 0 1px 0 #ffffffcc,inset 0 -3px 8px #00000026;
  font-family:Optima,'Gill Sans','Trebuchet MS',sans-serif;color:#3a3d42;}
.fx-sculpt-eq-root *{box-sizing:border-box;}
.fx-sculpt-eq-screw{position:absolute;width:11px;height:11px;border-radius:50%;z-index:2;
  background:radial-gradient(circle at 35% 30%,#f2f3f5,#9a9ea3 60%,#6e7378);
  box-shadow:0 1px 1px #0007,inset 0 0 1px #000a;}
.fx-sculpt-eq-screw::after{content:"";position:absolute;left:1px;right:1px;top:50%;height:1px;
  margin-top:-.5px;background:#4c5054;transform:rotate(var(--fx-slot,35deg));}
.fx-sculpt-eq-head{display:flex;align-items:baseline;gap:10px;padding:9px 22px 4px;flex:0 0 auto;}
.fx-sculpt-eq-logo{font-size:13px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  color:#f4ecd8;background:linear-gradient(180deg,#6a2e26,#4c1e18);padding:2px 9px;border-radius:3px;
  box-shadow:inset 0 1px 0 #ffffff33,0 1px 1px #0006;}
.fx-sculpt-eq-sub{font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#5a5e63;
  text-shadow:0 1px 0 #ffffffaa;}
.fx-sculpt-eq-serial{margin-left:auto;font-size:8px;letter-spacing:.14em;color:#7c8187;
  text-shadow:0 1px 0 #ffffff99;}
.fx-sculpt-eq-win{margin:2px 14px;flex:1 1 34%;min-height:54px;border-radius:4px;
  border:2px solid #6e7378;background:#f6efdc;box-shadow:inset 0 2px 8px #00000055,0 1px 0 #ffffff99;}
.fx-sculpt-eq-win canvas{width:100%;height:100%;display:block;}
.fx-sculpt-eq-deck{flex:1.5 1 auto;display:flex;flex-wrap:wrap;align-items:stretch;
  justify-content:space-evenly;align-content:space-evenly;gap:2px 4px;padding:4px 8px 10px;min-height:0;}
.fx-sculpt-eq-sec{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  gap:2px;padding:2px 8px;}
.fx-sculpt-eq-sec+.fx-sculpt-eq-sec{border-left:1px solid #00000022;box-shadow:-1px 0 0 #ffffff77;}
.fx-sculpt-eq-sec-title{font-size:9px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;
  color:#43464b;text-shadow:0 1px 0 #ffffffbb;}
.fx-sculpt-eq-sec-sub{font-size:7px;letter-spacing:.18em;text-transform:uppercase;color:#7c8187;
  text-shadow:0 1px 0 #ffffff99;}
.fx-sculpt-eq-row{display:flex;gap:10px;align-items:flex-start;}
.fx-sculpt-eq-cell{display:flex;flex-direction:column;align-items:center;gap:3px;}
.fx-sculpt-eq-knob{width:40px;height:40px;width:clamp(32px,10cqmin,58px);height:clamp(32px,10cqmin,58px);
  border-radius:50%;cursor:ns-resize;position:relative;flex:0 0 auto;
  background:radial-gradient(circle at 35% 28%,#fffdf4,#f0e7cc 52%,#cdc19e 82%,#a89c78);
  border:2px solid #8d8264;box-shadow:0 3px 5px #00000059,inset 0 1px 1px #ffffff;}
.fx-sculpt-eq-knob::after{content:"";position:absolute;left:50%;top:6%;width:14%;height:44%;
  margin-left:-7%;background:linear-gradient(180deg,#54312a,#3a201b);
  clip-path:polygon(50% 0,100% 100%,0 100%);transform-origin:50% 100%;
  transform:rotate(var(--fx-rot,0deg));}
.fx-sculpt-eq-klabel{font-size:8px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:#4a4d52;text-shadow:0 1px 0 #ffffffaa;}
.fx-sculpt-eq-kval{font-size:9px;font-family:ui-monospace,Menlo,monospace;color:#2f3235;
  background:#eceadf;border:1px solid #9a9ea3;border-radius:2px;padding:0 4px;min-width:48px;text-align:center;}
.fx-sculpt-eq-presets{display:none;flex:0 0 auto;flex-wrap:wrap;gap:6px;justify-content:center;
  padding:2px 14px 12px;}
.fx-sculpt-eq-expanded .fx-sculpt-eq-presets{display:flex;}
.fx-sculpt-eq-preset{font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:#43464b;background:linear-gradient(180deg,#f3efe2,#d8d2bd);
  border:1px solid #8d8264;border-radius:3px;padding:3px 10px;cursor:pointer;
  box-shadow:0 1px 2px #0005,inset 0 1px 0 #fff;}
.fx-sculpt-eq-preset:active{transform:translateY(1px);box-shadow:0 0 1px #0006,inset 0 1px 0 #fff;}
`;

// ---- fixed voicing (researched: Pultec/API/Neve program-EQ territory) ----
const FS = 48000;            // nominal rate for the analytic display curve
const MID_Q = 0.9;           // fixed musical proportional-ish Q (API 550 zone)
const LOW_SHELF_HZ = 110;    // Neve 1073 low-shelf tap
const HIGH_SHELF_HZ = 12000; // Neve 1073 fixed high shelf
const HP_OFF_HZ = 10;        // "bottomed out" low cut parks below audibility
const HP_Q_LIN = 0.7071;     // Butterworth (WebAudio highpass Q of -3.01 dB)

const DEFAULTS = {
  hpFreq: 20, lowGain: 0, loMidFreq: 220, loMidGain: 0,
  hiMidFreq: 2400, hiMidGain: 0, highGain: 0,
};

const PARAMS = {
  hpFreq:    { label: "Low Cut",     min: 20,   max: 400,  step: 1,   unit: "Hz", curve: "log" },
  lowGain:   { label: "Low Shelf",   min: -12,  max: 12,   step: 0.1, unit: "dB" },
  loMidFreq: { label: "Lo-Mid Freq", min: 70,   max: 700,  step: 1,   unit: "Hz", curve: "log" },
  loMidGain: { label: "Lo-Mid Gain", min: -15,  max: 15,   step: 0.1, unit: "dB" },
  hiMidFreq: { label: "Hi-Mid Freq", min: 700,  max: 8000, step: 10,  unit: "Hz", curve: "log" },
  hiMidGain: { label: "Hi-Mid Gain", min: -15,  max: 15,   step: 0.1, unit: "dB" },
  highGain:  { label: "High Shelf",  min: -12,  max: 12,   step: 0.1, unit: "dB" },
};

const PRESETS = [
  { name: "Vocal Sheen",
    params: { hpFreq: 95,  lowGain: -1.5, loMidFreq: 240, loMidGain: -2.5, hiMidFreq: 3200, hiMidGain: 2,   highGain: 4 } },
  { name: "Bass Anchor",
    params: { hpFreq: 20,  lowGain: 4.5,  loMidFreq: 120, loMidGain: 1.5,  hiMidFreq: 900,  hiMidGain: -2,  highGain: -1.5 } },
  { name: "Drum Glue",
    params: { hpFreq: 32,  lowGain: 2.5,  loMidFreq: 380, loMidGain: -3.5, hiMidFreq: 4200, hiMidGain: 2.5, highGain: 1.5 } },
  { name: "Mud Cleaner",
    params: { hpFreq: 70,  lowGain: 0,    loMidFreq: 300, loMidGain: -5,   hiMidFreq: 1800, hiMidGain: 1,   highGain: 0.5 } },
  { name: "Wireless '52",
    params: { hpFreq: 320, lowGain: -9,   loMidFreq: 550, loMidGain: 3,    hiMidFreq: 1600, hiMidGain: 6,   highGain: -12 } },
];

const hpEffective = (v) => (v <= PARAMS.hpFreq.min + 0.5 ? HP_OFF_HZ : v);

function injectCss() {
  if (!document.head.querySelector('style[data-fx="sculpt-eq"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "sculpt-eq";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// ---- RBJ audio-EQ-cookbook coefficients (matches native BiquadFilterNode) ----
function rbj(type, f, Q, gainDb) {
  const w0 = 2 * Math.PI * Math.min(f, FS * 0.49) / FS;
  const cs = Math.cos(w0), sn = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2, alpha;
  if (type === "highpass") {
    alpha = sn / (2 * Q);
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
    a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
  } else if (type === "peaking") {
    alpha = sn / (2 * Q);
    b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
  } else { // low/high shelf, shelf slope S = 1 (WebAudio's fixed shelf slope)
    alpha = (sn / 2) * Math.sqrt(2);          // S=1 → sqrt((A+1/A)(1/S−1)+2)=√2
    const sq = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs);
      b2 = A * ((A + 1) - (A - 1) * cs - sq);
      a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs);
      a2 = (A + 1) + (A - 1) * cs - sq;
    } else { // highshelf
      b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs);
      b2 = A * ((A + 1) + (A - 1) * cs - sq);
      a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs);
      a2 = (A + 1) - (A - 1) * cs - sq;
    }
  }
  return { b0, b1, b2, a0, a1, a2 };
}

function magDb(c, f) {
  const w = 2 * Math.PI * f / FS;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = c.a0 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di));
}

function bandCoeffs(p) {
  return [
    rbj("highpass",  hpEffective(p.hpFreq), HP_Q_LIN, 0),
    rbj("lowshelf",  LOW_SHELF_HZ,  1, p.lowGain),
    rbj("peaking",   p.loMidFreq,   MID_Q, p.loMidGain),
    rbj("peaking",   p.hiMidFreq,   MID_Q, p.hiMidGain),
    rbj("highshelf", HIGH_SHELF_HZ, 1, p.highGain),
  ];
}

export default {
  id: "sculpt-eq",
  name: "Sculpt EQ",
  category: "Filter & EQ",
  description: "Console-style 4-band program EQ — low cut, twin sculpting mids and silky shelves.",
  defaults: DEFAULTS,
  params: PARAMS,
  presets: PRESETS,
  // shaping effect → no defaultWet, processes the whole signal at wet=1

  build(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = HP_OFF_HZ; hp.Q.value = -3.01; // dB → Butterworth
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf"; low.frequency.value = LOW_SHELF_HZ; low.gain.value = 0;
    const m1 = ctx.createBiquadFilter();
    m1.type = "peaking"; m1.frequency.value = DEFAULTS.loMidFreq; m1.Q.value = MID_Q; m1.gain.value = 0;
    const m2 = ctx.createBiquadFilter();
    m2.type = "peaking"; m2.frequency.value = DEFAULTS.hiMidFreq; m2.Q.value = MID_Q; m2.gain.value = 0;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf"; high.frequency.value = HIGH_SHELF_HZ; high.gain.value = 0;
    input.connect(hp); hp.connect(low); low.connect(m1); m1.connect(m2); m2.connect(high); high.connect(output);
    const nodes = [input, hp, low, m1, m2, high, output];
    return {
      input,
      output,
      update(p) {
        const t = ctx.currentTime, k = 0.02;
        hp.frequency.setTargetAtTime(hpEffective(p.hpFreq), t, k);
        low.gain.setTargetAtTime(p.lowGain, t, k);
        m1.frequency.setTargetAtTime(p.loMidFreq, t, k);
        m1.gain.setTargetAtTime(p.loMidGain, t, k);
        m2.frequency.setTargetAtTime(p.hiMidFreq, t, k);
        m2.gain.setTargetAtTime(p.hiMidGain, t, k);
        high.gain.setTargetAtTime(p.highGain, t, k);
      },
      dispose() {
        for (const n of nodes) { try { n.disconnect(); } catch {} }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = PARAMS;
    const KEYS = Object.keys(P);
    const root = document.createElement("div");
    root.className = "fx-sculpt-eq-root" + (host.expanded ? " fx-sculpt-eq-expanded" : "");
    const cell = (k, label) => `
      <div class="fx-sculpt-eq-cell">
        <div class="fx-sculpt-eq-knob" data-knob="${k}"></div>
        <span class="fx-sculpt-eq-klabel">${label}</span>
        <span class="fx-sculpt-eq-kval" data-val="${k}"></span>
      </div>`;
    root.innerHTML = `
      <span class="fx-sculpt-eq-screw" style="top:5px;left:5px;--fx-slot:28deg"></span>
      <span class="fx-sculpt-eq-screw" style="top:5px;right:5px;--fx-slot:-52deg"></span>
      <span class="fx-sculpt-eq-screw" style="bottom:5px;left:5px;--fx-slot:80deg"></span>
      <span class="fx-sculpt-eq-screw" style="bottom:5px;right:5px;--fx-slot:-15deg"></span>
      <div class="fx-sculpt-eq-head">
        <span class="fx-sculpt-eq-logo">Vanderlyn</span>
        <span class="fx-sculpt-eq-sub">sculpt equalizer · type 4B</span>
        <span class="fx-sculpt-eq-serial">SER Nº 0447</span>
      </div>
      <div class="fx-sculpt-eq-win"><canvas></canvas></div>
      <div class="fx-sculpt-eq-deck">
        <div class="fx-sculpt-eq-sec">
          <span class="fx-sculpt-eq-sec-title">Cut</span>
          <span class="fx-sculpt-eq-sec-sub">12 dB/oct</span>
          <div class="fx-sculpt-eq-row">${cell("hpFreq", "Freq")}</div>
        </div>
        <div class="fx-sculpt-eq-sec">
          <span class="fx-sculpt-eq-sec-title">Low</span>
          <span class="fx-sculpt-eq-sec-sub">shelf 110 Hz</span>
          <div class="fx-sculpt-eq-row">${cell("lowGain", "Gain")}</div>
        </div>
        <div class="fx-sculpt-eq-sec">
          <span class="fx-sculpt-eq-sec-title">Lo Mid</span>
          <span class="fx-sculpt-eq-sec-sub">peak · Q 0.9</span>
          <div class="fx-sculpt-eq-row">${cell("loMidFreq", "Freq")}${cell("loMidGain", "Gain")}</div>
        </div>
        <div class="fx-sculpt-eq-sec">
          <span class="fx-sculpt-eq-sec-title">Hi Mid</span>
          <span class="fx-sculpt-eq-sec-sub">peak · Q 0.9</span>
          <div class="fx-sculpt-eq-row">${cell("hiMidFreq", "Freq")}${cell("hiMidGain", "Gain")}</div>
        </div>
        <div class="fx-sculpt-eq-sec">
          <span class="fx-sculpt-eq-sec-title">High</span>
          <span class="fx-sculpt-eq-sec-sub">shelf 12 kHz</span>
          <div class="fx-sculpt-eq-row">${cell("highGain", "Gain")}</div>
        </div>
      </div>
      <div class="fx-sculpt-eq-presets">
        ${PRESETS.map((pr, i) => `<button class="fx-sculpt-eq-preset" data-preset="${i}">${pr.name}</button>`).join("")}
      </div>`;
    container.appendChild(root);

    const canvas = root.querySelector("canvas");
    const cx = canvas.getContext("2d");

    const toNorm = (k, v) => P[k].curve === "log"
      ? Math.log(v / P[k].min) / Math.log(P[k].max / P[k].min)
      : (v - P[k].min) / (P[k].max - P[k].min);
    const fromNorm = (k, n) => {
      n = Math.min(1, Math.max(0, n));
      return P[k].curve === "log"
        ? P[k].min * Math.pow(P[k].max / P[k].min, n)
        : P[k].min + n * (P[k].max - P[k].min);
    };
    const fmt = (k, v) => {
      if (P[k].unit === "Hz") {
        if (k === "hpFreq" && v <= P.hpFreq.min + 0.5) return "OFF";
        return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
      }
      return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
    };
    const paint = () => {
      const p = host.params;
      for (const k of KEYS) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${-135 + 270 * toNorm(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
    };
    paint();

    // knobs: vertical drag (log-aware), double-click reset
    for (const k of KEYS) {
      const el = root.querySelector(`[data-knob="${k}"]`);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, startN = toNorm(k, host.params[k]);
        const move = (ev) => {
          let v = fromNorm(k, startN + (startY - ev.clientY) / 140);
          v = Math.round(v / P[k].step) * P[k].step;
          v = +Math.min(P[k].max, Math.max(P[k].min, v)).toFixed(3);
          host.setParam(k, v);
          paint();
        };
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      });
      el.addEventListener("dblclick", () => { host.setParam(k, DEFAULTS[k]); paint(); });
    }

    for (const btn of root.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => {
        const pr = PRESETS[+btn.dataset.preset].params;
        for (const k of KEYS) host.setParam(k, pr[k]);
        paint();
      });
    }

    // response window: analytic curve on chart paper + faint live spectrum
    let raf = 0;
    let specBuf = null;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * d));
      canvas.height = Math.max(1, Math.round(r.height * d));
    });
    ro.observe(canvas);

    const F_MIN = 20, F_MAX = 20000, DB_RANGE = 18;
    const draw = () => {
      if (!root.isConnected) return;
      const w = canvas.width, h = canvas.height, d = devicePixelRatio || 1;
      if (w < 4 || h < 4) { raf = requestAnimationFrame(draw); return; }
      const p = host.params;
      const xOf = (f) => w * Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
      const pad = 5 * d;
      const yOf = (db) => h / 2 - (db / DB_RANGE) * (h / 2 - pad);

      cx.fillStyle = "#f6efdc";
      cx.fillRect(0, 0, w, h);
      // grid — aged chart paper
      cx.lineWidth = Math.max(1, d * 0.7);
      cx.strokeStyle = "#e2d5ae";
      cx.beginPath();
      for (const f of [30, 50, 70, 200, 300, 500, 700, 2000, 3000, 5000, 7000, 15000]) {
        const x = xOf(f); cx.moveTo(x, 0); cx.lineTo(x, h);
      }
      for (const db of [-12, -6, 6, 12]) { const y = yOf(db); cx.moveTo(0, y); cx.lineTo(w, y); }
      cx.stroke();
      cx.strokeStyle = "#c9b784";
      cx.beginPath();
      for (const f of [100, 1000, 10000]) { const x = xOf(f); cx.moveTo(x, 0); cx.lineTo(x, h); }
      cx.stroke();
      cx.strokeStyle = "#b09a63";
      cx.beginPath(); cx.moveTo(0, yOf(0)); cx.lineTo(w, yOf(0)); cx.stroke();
      cx.fillStyle = "#a08c5c";
      cx.font = `${Math.max(8, 8.5 * d)}px ui-monospace,Menlo,monospace`;
      cx.fillText("100", xOf(100) + 3 * d, h - 3 * d);
      cx.fillText("1k", xOf(1000) + 3 * d, h - 3 * d);
      cx.fillText("10k", xOf(10000) + 3 * d, h - 3 * d);
      cx.fillText("+12", 3 * d, yOf(12) - 2 * d);
      cx.fillText("-12", 3 * d, yOf(-12) - 2 * d);

      // live spectrum behind the curve, if the host taps our wet output
      if (host.analyser) {
        const an = host.analyser;
        if (!specBuf || specBuf.length !== an.frequencyBinCount) specBuf = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(specBuf);
        const sr = an.context ? an.context.sampleRate : FS;
        cx.fillStyle = "rgba(122,108,74,0.16)";
        cx.beginPath();
        cx.moveTo(0, h);
        for (let x = 0; x <= w; x += Math.max(2, d * 2)) {
          const f = F_MIN * Math.pow(F_MAX / F_MIN, x / w);
          const bin = Math.min(specBuf.length - 1, Math.round(f / (sr / 2) * specBuf.length));
          cx.lineTo(x, h - (specBuf[bin] / 255) * h * 0.9);
        }
        cx.lineTo(w, h);
        cx.closePath();
        cx.fill();
      }

      // analytic response curve — red draughting ink
      const coeffs = bandCoeffs(p);
      const step = Math.max(1, w / 220);
      cx.beginPath();
      for (let x = 0; x <= w + step; x += step) {
        const f = F_MIN * Math.pow(F_MAX / F_MIN, Math.min(1, x / w));
        let db = 0;
        for (const c of coeffs) db += magDb(c, f);
        const y = yOf(Math.max(-DB_RANGE - 6, Math.min(DB_RANGE + 6, db)));
        x === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y);
      }
      cx.strokeStyle = "#8a2f24";
      cx.lineWidth = Math.max(1.5, 1.4 * d);
      cx.lineJoin = "round";
      cx.stroke();
      cx.lineTo(w, yOf(0)); cx.lineTo(0, yOf(0)); cx.closePath();
      cx.fillStyle = "rgba(138,47,36,0.08)";
      cx.fill();

      // band markers riding the curve
      const marks = [];
      if (p.hpFreq > P.hpFreq.min + 0.5) marks.push(p.hpFreq);
      marks.push(LOW_SHELF_HZ, p.loMidFreq, p.hiMidFreq, HIGH_SHELF_HZ);
      for (const f of marks) {
        let db = 0;
        for (const c of coeffs) db += magDb(c, f);
        cx.beginPath();
        cx.arc(xOf(f), yOf(Math.max(-DB_RANGE, Math.min(DB_RANGE, db))), Math.max(2.5, 2.2 * d), 0, 7);
        cx.fillStyle = "#f6efdc"; cx.fill();
        cx.lineWidth = Math.max(1.2, 1.1 * d); cx.strokeStyle = "#8a2f24"; cx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
