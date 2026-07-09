// Tape Echo — warm tape-loop echo with mechanical soul. Modelled on the
// behaviour of classic tape units (Roland RE-201 Space Echo, Maestro
// Echoplex EP-3): motor-speed delay from tight slapback to long loops,
// feedback past unity into blooming self-oscillation (soft-clipped in the
// loop so it never explodes), every repeat darkened by the playback-head
// lowpass and gently saturated, and wow & flutter as a slow+fast LFO pair
// nudging the tape speed. WET-ONLY output — the host does the dry/wet mix.
//
// Loop topology:
//   input → [ DelayNode → tone lowpass → soft-clip shaper → feedback gain ⤴ ]
//                                └── wet tap (post-heads) → output

const CSS = `
.fx-tape-echo-root{width:100%;height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  background:linear-gradient(168deg,#39473d 0%,#2a352d 48%,#1d2620 100%);
  border-radius:10px;border:1px solid #10160f;
  box-shadow:inset 0 1px 0 #ffffff22,inset 0 -16px 34px #0007,inset 0 0 0 3px #45543f44;
  font-family:'Avenir Next','Helvetica Neue',Verdana,sans-serif;color:#d9e2c8;
  overflow:hidden;position:relative;}
.fx-tape-echo-root *{box-sizing:border-box;}
.fx-tape-echo-head{display:flex;align-items:baseline;gap:10px;padding:9px 14px 4px;flex:0 0 auto;}
.fx-tape-echo-logo{font-size:15px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:#ece5c4;text-shadow:0 1px 0 #0009;}
.fx-tape-echo-sub{font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#93a888;}
.fx-tape-echo-lamp{margin-left:auto;align-self:center;width:15px;height:15px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#cfe8b8,#4d7a3a 55%,#1d3315);
  border:2px solid #141b12;box-shadow:0 0 0 2px #45543f,0 1px 2px #0008;transition:background .15s;}
.fx-tape-echo-lamp.fx-tape-echo-lamp-hot{
  background:radial-gradient(circle at 35% 30%,#ffd9cc,#c03420 55%,#5a0f06);
  animation:fx-tape-echo-pulse 0.7s ease-in-out infinite alternate;}
@keyframes fx-tape-echo-pulse{
  from{box-shadow:0 0 0 2px #45543f,0 0 4px 1px #ff503055;}
  to{box-shadow:0 0 0 2px #45543f,0 0 14px 5px #ff5030aa;}}
.fx-tape-echo-legend{flex:0 0 auto;margin:0 14px 5px;padding:2px 0 3px;display:flex;justify-content:space-between;
  border-top:1px solid #ffffff1c;border-bottom:1px solid #0006;
  font-size:8px;letter-spacing:.24em;text-transform:uppercase;color:#8ba07e;white-space:nowrap;overflow:hidden;}
.fx-tape-echo-main{flex:1 1 auto;display:flex;gap:8px;margin:0 14px;min-height:0;}
.fx-tape-echo-window{flex:1.7 1 0;min-width:0;background:#0f140d;border-radius:6px;
  border:2px solid #59684c;box-shadow:inset 0 3px 10px #000d;overflow:hidden;}
.fx-tape-echo-vu{flex:1 1 0;min-width:72px;background:#efe6c4;border-radius:6px;
  border:2px solid #59684c;box-shadow:inset 0 2px 6px #0008;overflow:hidden;}
.fx-tape-echo-window canvas,.fx-tape-echo-vu canvas{width:100%;height:100%;display:block;}
.fx-tape-echo-knobs{flex:0 0 auto;display:flex;align-items:center;justify-content:space-evenly;
  padding:8px 8px 12px;gap:4px;}
.fx-tape-echo-cell{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:60px;}
.fx-tape-echo-knob{width:50px;height:50px;border-radius:50%;cursor:ns-resize;position:relative;touch-action:none;
  background:radial-gradient(circle at 32% 28%,#4d584a,#141a13 72%);
  border:3px solid #b9c4a4;box-shadow:0 3px 7px #000a,inset 0 1px 1px #fff3;}
.fx-tape-echo-knob::after{content:"";position:absolute;left:50%;top:4px;width:4px;height:17px;
  margin-left:-2px;border-radius:2px;background:#ece5c4;transform-origin:2px 21px;
  transform:rotate(var(--fx-rot,0deg));}
.fx-tape-echo-label{font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#aebf9c;}
.fx-tape-echo-val{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#b7e08c;
  background:#101710;border:1px solid #59684c;border-radius:3px;padding:0 5px;min-width:56px;text-align:center;}
.fx-tape-echo-presets{display:none;flex:0 0 auto;gap:6px;flex-wrap:wrap;padding:0 14px 10px;}
.fx-tape-echo-root.fx-tape-echo-xl .fx-tape-echo-presets{display:flex;}
.fx-tape-echo-preset{font:inherit;font-size:9px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;
  color:#d9e2c8;background:#1d2620;border:1px solid #59684c;border-radius:4px;padding:3px 9px;}
.fx-tape-echo-preset:hover{background:#2f3b30;color:#ece5c4;}
`;

function injectCss() {
  if (!document.head.querySelector('style[data-fx="tape-echo"]')) {
    const s = document.createElement("style");
    s.dataset.fx = "tape-echo";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
}

// Gentle tape-style limiter for the feedback loop: slope 1 at the origin
// (so small signals see the raw feedback gain and the self-oscillation
// threshold sits honestly at feedback = 1.0) but tanh-compressed peaks, so
// runaway feedback blooms to a bounded, softly saturated drone.
function softClipCurve() {
  const k = 1.25, n = 1025, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / k;
  }
  return c;
}

const SELF_OSC = 1.0; // loop gain ≥ 1 → regeneration

export default {
  id: "tape-echo",
  name: "Tape Echo",
  category: "Delay & Echo",
  description: "Warm tape-loop echo — darkening repeats, wow and flutter, runaway dub self-oscillation.",
  defaults: { time: 0.36, feedback: 0.45, tone: 3500, wow: 0.3 },
  params: {
    // RE-201 heads cover ~50–650 ms at sane motor speeds; slowed motors and
    // long-loop units stretch past a second — 50 ms–1.2 s covers slapback
    // through dub without ever leaving musical territory.
    time:     { label: "Time",    min: 0.05, max: 1.2,  step: 0.005, unit: "s"  },
    // >1 allowed on purpose: the in-loop soft clip keeps runaway bounded.
    feedback: { label: "Repeats", min: 0,    max: 1.1,  step: 0.01,  unit: ""   },
    // Playback-head lowpass. 1.5 kHz = worn-tape murk, 8 kHz = fresh tape.
    tone:     { label: "Tone",    min: 1500, max: 8000, step: 50,    unit: "Hz", curve: "log" },
    wow:      { label: "Wow",     min: 0,    max: 1,    step: 0.01,  unit: ""   },
  },
  presets: [
    { name: "Slapback '58",  params: { time: 0.115, feedback: 0.10, tone: 5200, wow: 0.12 } },
    { name: "Tape Ballad",   params: { time: 0.42,  feedback: 0.55, tone: 2800, wow: 0.35 } },
    { name: "Worn Cassette", params: { time: 0.30,  feedback: 0.48, tone: 1700, wow: 0.90 } },
    { name: "Dub Bloom",     params: { time: 0.58,  feedback: 1.05, tone: 2400, wow: 0.40 } },
    { name: "Canyon Drift",  params: { time: 1.10,  feedback: 0.68, tone: 3000, wow: 0.50 } },
  ],
  defaultWet: 0.4, // wet-only module: host crossfades dry/wet

  build(ctx) {
    const d = this.defaults;
    const input = ctx.createGain();
    const delay = ctx.createDelay(2.0);           // 1.2 s max + wow headroom
    const tone = ctx.createBiquadFilter();
    const shaper = ctx.createWaveShaper();
    const fb = ctx.createGain();
    const output = ctx.createGain();

    delay.delayTime.value = d.time;
    tone.type = "lowpass";
    tone.frequency.value = d.tone;
    tone.Q.value = 0.4;                            // broad, tape-like rolloff
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    fb.gain.value = d.feedback;
    output.gain.value = 1;

    // the tape loop
    input.connect(delay);
    delay.connect(tone);
    tone.connect(shaper);
    shaper.connect(fb);
    fb.connect(delay);
    // wet tap AFTER the heads so even the first repeat is darkened + saturated
    shaper.connect(output);

    // wow (slow motor drift) + flutter (fast capstan jitter) → delayTime.
    // Depths in seconds: up to ~3.2 ms wow and ~0.55 ms flutter at full knob.
    const wowLfo = ctx.createOscillator();
    const flutLfo = ctx.createOscillator();
    const wowDepth = ctx.createGain();
    const flutDepth = ctx.createGain();
    wowLfo.type = "sine";   wowLfo.frequency.value = 0.65;
    flutLfo.type = "sine";  flutLfo.frequency.value = 6.2;
    wowDepth.gain.value = d.wow * 0.0032;
    flutDepth.gain.value = d.wow * 0.00055;
    wowLfo.connect(wowDepth);   wowDepth.connect(delay.delayTime);
    flutLfo.connect(flutDepth); flutDepth.connect(delay.delayTime);
    wowLfo.start(ctx.currentTime);
    flutLfo.start(ctx.currentTime);

    return {
      input,
      output,
      update(p) {
        const t = ctx.currentTime;
        // Deliberately lazy time constant: dragging Time re-pitches the
        // repeats like a real motor-speed change (varispeed warble).
        delay.delayTime.setTargetAtTime(p.time, t, 0.09);
        fb.gain.setTargetAtTime(Math.min(p.feedback, 1.1), t, 0.02);
        tone.frequency.setTargetAtTime(p.tone, t, 0.02);
        wowDepth.gain.setTargetAtTime(p.wow * 0.0032, t, 0.02);
        flutDepth.gain.setTargetAtTime(p.wow * 0.00055, t, 0.02);
      },
      dispose() {
        try { wowLfo.stop(); } catch {}
        try { flutLfo.stop(); } catch {}
        for (const n of [input, delay, tone, shaper, fb, output, wowLfo, flutLfo, wowDepth, flutDepth]) {
          try { n.disconnect(); } catch {}
        }
      },
    };
  },

  ui(container, host) {
    injectCss();
    const P = this.params;
    const defaults = this.defaults;
    const presets = this.presets;
    const root = document.createElement("div");
    root.className = "fx-tape-echo-root" + (host.expanded ? " fx-tape-echo-xl" : "");
    root.innerHTML = `
      <div class="fx-tape-echo-head">
        <span class="fx-tape-echo-logo">Meadowtone</span>
        <span class="fx-tape-echo-sub">loop chamber &middot; LC-3</span>
        <span class="fx-tape-echo-lamp" data-lamp title="regeneration"></span>
      </div>
      <div class="fx-tape-echo-legend">
        <span>echo</span><span>repeat</span><span>sound-on-sound</span><span>reel &sdot; 1/4&Prime;</span>
      </div>
      <div class="fx-tape-echo-main">
        <div class="fx-tape-echo-window"><canvas data-tape></canvas></div>
        <div class="fx-tape-echo-vu"><canvas data-vu></canvas></div>
      </div>
      <div class="fx-tape-echo-knobs">
        ${Object.keys(P).map((k) => `
          <div class="fx-tape-echo-cell">
            <div class="fx-tape-echo-knob" data-knob="${k}"></div>
            <span class="fx-tape-echo-label">${P[k].label}</span>
            <span class="fx-tape-echo-val" data-val="${k}"></span>
          </div>`).join("")}
      </div>
      <div class="fx-tape-echo-presets">
        ${presets.map((pr, i) => `<button type="button" class="fx-tape-echo-preset" data-preset="${i}">${pr.name}</button>`).join("")}
      </div>`;
    container.appendChild(root);

    const lamp = root.querySelector("[data-lamp]");
    const tapeCv = root.querySelector("[data-tape]");
    const vuCv = root.querySelector("[data-vu]");
    const tapeCx = tapeCv.getContext("2d");
    const vuCx = vuCv.getContext("2d");

    // --- param helpers (log-aware for Tone) -------------------------------
    const norm = (k, v) => P[k].curve === "log"
      ? Math.log(v / P[k].min) / Math.log(P[k].max / P[k].min)
      : (v - P[k].min) / (P[k].max - P[k].min);
    const denorm = (k, n) => P[k].curve === "log"
      ? P[k].min * Math.pow(P[k].max / P[k].min, n)
      : P[k].min + n * (P[k].max - P[k].min);
    const fmt = (k, v) => {
      if (k === "time") return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
      if (k === "tone") return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
      return `${Math.round(v * 100)}%`;
    };
    const paint = () => {
      const p = host.params;
      for (const k of Object.keys(P)) {
        root.querySelector(`[data-knob="${k}"]`).style.setProperty("--fx-rot", `${-135 + 270 * norm(k, p[k])}deg`);
        root.querySelector(`[data-val="${k}"]`).textContent = fmt(k, p[k]);
      }
      lamp.classList.toggle("fx-tape-echo-lamp-hot", p.feedback >= SELF_OSC);
    };
    paint();

    // --- knobs: vertical drag + dblclick reset ----------------------------
    for (const k of Object.keys(P)) {
      const el = root.querySelector(`[data-knob="${k}"]`);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY, startN = norm(k, host.params[k]);
        const move = (ev) => {
          const n = Math.min(1, Math.max(0, startN + (startY - ev.clientY) / 160));
          let v = Math.round(denorm(k, n) / P[k].step) * P[k].step;
          v = Math.min(P[k].max, Math.max(P[k].min, v));
          host.setParam(k, v);
          paint();
        };
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      });
      el.addEventListener("dblclick", () => { host.setParam(k, defaults[k]); paint(); });
    }

    // --- presets (expanded view) ------------------------------------------
    for (const btn of root.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => {
        const pr = presets[+btn.dataset.preset];
        for (const [k, v] of Object.entries(pr.params)) host.setParam(k, v);
        paint();
      });
    }

    // --- canvases: dpr-aware sizing ---------------------------------------
    const ro = new ResizeObserver(() => {
      for (const cv of [tapeCv, vuCv]) {
        const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
        cv.width = Math.max(1, Math.round(r.width * d));
        cv.height = Math.max(1, Math.round(r.height * d));
      }
    });
    ro.observe(tapeCv);
    ro.observe(vuCv);

    // --- animation: tape path + reels + VU needle -------------------------
    let raf = 0;
    let reelAngle = 0, tapePos = 0, vuLevel = 0;
    let lastT = performance.now();
    let anaBuf = null;

    const drawTape = (p, dt, w, h) => {
      tapeCx.clearRect(0, 0, w, h);
      const cy = h * 0.42;
      const r = Math.max(6, Math.min(h * 0.30, w * 0.16));
      const cx1 = w * 0.28, cx2 = w * 0.72;

      // motion: reel speed and tape travel inversely tied to delay time
      reelAngle += dt * Math.min(30, 1.6 / Math.max(p.time, 0.05));
      const pxSpeed = Math.min(w * 1.2, (w * 0.055) / Math.max(p.time, 0.05));
      tapePos = (tapePos + dt * pxSpeed) % 1e6;

      // tape loop: stadium path around both reels
      tapeCx.strokeStyle = "#6e4a30";
      tapeCx.lineWidth = Math.max(2, h / 46);
      tapeCx.beginPath();
      tapeCx.moveTo(cx1, cy - r);
      tapeCx.lineTo(cx2, cy - r);
      tapeCx.arc(cx2, cy, r, -Math.PI / 2, Math.PI / 2);
      tapeCx.lineTo(cx1, cy + r);
      tapeCx.arc(cx1, cy, r, Math.PI / 2, Math.PI * 1.5);
      tapeCx.stroke();

      // moving splice ticks along top + bottom spans (tape travel illusion)
      tapeCx.strokeStyle = "#a97d52";
      tapeCx.lineWidth = Math.max(1, h / 90);
      const span = cx2 - cx1, tick = Math.max(14, w / 14);
      for (let i = 0; i < span / tick + 1; i++) {
        const off = (i * tick + tapePos) % span;
        tapeCx.beginPath();
        tapeCx.moveTo(cx1 + off, cy + r - 3); tapeCx.lineTo(cx1 + off, cy + r + 3);
        tapeCx.moveTo(cx2 - off, cy - r - 3); tapeCx.lineTo(cx2 - off, cy - r + 3);
        tapeCx.stroke();
      }

      // reels: pancake, hub, three spokes
      for (const cx of [cx1, cx2]) {
        tapeCx.fillStyle = "#241a11";
        tapeCx.beginPath(); tapeCx.arc(cx, cy, r * 0.94, 0, 7); tapeCx.fill();
        tapeCx.fillStyle = "#3a2b1c";
        tapeCx.beginPath(); tapeCx.arc(cx, cy, r * 0.78, 0, 7); tapeCx.fill();
        tapeCx.strokeStyle = "#b9c4a4";
        tapeCx.lineWidth = Math.max(1.5, r / 12);
        for (let s = 0; s < 3; s++) {
          const a = reelAngle + (s * 2 * Math.PI) / 3;
          tapeCx.beginPath();
          tapeCx.moveTo(cx + Math.cos(a) * r * 0.16, cy + Math.sin(a) * r * 0.16);
          tapeCx.lineTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
          tapeCx.stroke();
        }
        tapeCx.fillStyle = "#8ba07e";
        tapeCx.beginPath(); tapeCx.arc(cx, cy, r * 0.14, 0, 7); tapeCx.fill();
      }

      // head bridge on the lower span: fixed record head, playback head whose
      // spacing from it tracks the Time knob (Echoplex-style sliding head)
      const hy = cy + r;
      const hx0 = cx1 + span * 0.08;
      const usable = span * 0.84;
      const hx1 = hx0 + usable * norm("time", p.time);
      tapeCx.fillStyle = "#59684c";
      tapeCx.fillRect(hx0 - 4, hy - 7, 8, 14);          // record head
      const glow = p.feedback >= SELF_OSC ? "#ff6a4a" : "#9fe07a";
      tapeCx.fillStyle = glow;
      tapeCx.shadowColor = glow; tapeCx.shadowBlur = 8;
      tapeCx.beginPath(); tapeCx.arc(hx1, hy, Math.max(3, h / 30), 0, 7); tapeCx.fill();
      tapeCx.shadowBlur = 0;
      tapeCx.strokeStyle = "#59684c";
      tapeCx.lineWidth = 1;
      tapeCx.beginPath(); tapeCx.moveTo(hx0, hy + 10); tapeCx.lineTo(hx1, hy + 10); tapeCx.stroke();
    };

    const drawVu = (p, w, h) => {
      // signal level from the wet analyser, else needle rests
      let target = 0;
      if (host.analyser) {
        if (!anaBuf || anaBuf.length !== host.analyser.fftSize) anaBuf = new Uint8Array(host.analyser.fftSize);
        host.analyser.getByteTimeDomainData(anaBuf);
        let peak = 0;
        for (let i = 0; i < anaBuf.length; i++) {
          const d = Math.abs(anaBuf[i] - 128);
          if (d > peak) peak = d;
        }
        target = Math.min(1, peak / 110);
      }
      vuLevel += (target - vuLevel) * (target > vuLevel ? 0.35 : 0.055); // fast attack, slow fall
      const wig = vuLevel * p.wow * 0.03 * Math.sin(performance.now() / 90);

      vuCx.clearRect(0, 0, w, h);
      vuCx.fillStyle = "#efe6c4"; vuCx.fillRect(0, 0, w, h);
      const px = w / 2, py = h * 0.94, len = Math.min(h * 0.72, w * 0.62);
      const a0 = -Math.PI / 2 - 0.78, a1 = -Math.PI / 2 + 0.78;
      // scale arc + red zone
      vuCx.lineWidth = Math.max(2, h / 40);
      vuCx.strokeStyle = "#2b2b23";
      vuCx.beginPath(); vuCx.arc(px, py, len, a0, a0 + (a1 - a0) * 0.72); vuCx.stroke();
      vuCx.strokeStyle = "#b3311f";
      vuCx.beginPath(); vuCx.arc(px, py, len, a0 + (a1 - a0) * 0.72, a1); vuCx.stroke();
      // ticks
      vuCx.strokeStyle = "#2b2b23"; vuCx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const a = a0 + (a1 - a0) * (i / 6);
        vuCx.beginPath();
        vuCx.moveTo(px + Math.cos(a) * len * 0.92, py + Math.sin(a) * len * 0.92);
        vuCx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
        vuCx.stroke();
      }
      vuCx.fillStyle = "#2b2b23";
      vuCx.font = `700 ${Math.max(8, h / 9)}px Verdana,sans-serif`;
      vuCx.textAlign = "center";
      vuCx.fillText("VU", px, py - len * 0.32);
      // needle
      const na = a0 + (a1 - a0) * Math.min(1, Math.max(0, vuLevel + wig));
      vuCx.strokeStyle = "#1c1c16"; vuCx.lineWidth = Math.max(1.5, h / 60);
      vuCx.beginPath();
      vuCx.moveTo(px, py);
      vuCx.lineTo(px + Math.cos(na) * len * 0.96, py + Math.sin(na) * len * 0.96);
      vuCx.stroke();
      vuCx.fillStyle = "#1c1c16";
      vuCx.beginPath(); vuCx.arc(px, py, Math.max(3, h / 22), 0, 7); vuCx.fill();
    };

    const draw = () => {
      if (!root.isConnected) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const p = host.params;
      if (tapeCv.width > 2) drawTape(p, dt, tapeCv.width, tapeCv.height);
      if (vuCv.width > 2) drawVu(p, vuCv.width, vuCv.height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); root.remove(); };
  },
};
