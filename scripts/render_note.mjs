#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (error) {
    // Git worktrees intentionally do not duplicate node_modules. Resolve the
    // dependency from the primary worktree containing the shared .git dir.
    try {
      const common = execFileSync(
        "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8" },
      ).trim();
      const require = createRequire(join(dirname(common), "package.json"));
      return require("playwright").chromium;
    } catch {
      throw error;
    }
  }
}

const chromium = await loadChromium();

let rootUrl = process.env.SG2_URL || null;

async function reserveLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function usage(message = "") {
  if (message) console.error(message);
  console.error(`Usage:
  node scripts/render_note.mjs --params sound.json --midi 60 --out note.wav [--velocity .62] [--duration 1.5] [--sample-rate 48000]
  node scripts/render_note.mjs --batch jobs.json
  node scripts/render_note.mjs --verify

Batch JSON is an array of {params|paramsFile,paramsOverride,midi,velocity,durationSec,sampleRate,out}.`);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--help" || key === "-h") usage();
    if (key === "--verify") { out.verify = true; continue; }
    if (!key.startsWith("--") || i + 1 >= argv.length) usage(`Unknown argument: ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  return out;
}

async function serverReady() {
  if (!rootUrl) return false;
  try {
    const response = await fetch(`${rootUrl}/index.html`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  // An explicit SG2_URL is an intentionally managed server. Otherwise every
  // renderer owns a fresh loopback port so concurrent worktrees cannot reuse
  // or block one another's checkout-bound web assets.
  if (rootUrl) {
    for (let i = 0; i < 600; i++) {
      if (await serverReady()) return null;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for managed server ${rootUrl}`);
  }
  const port = await reserveLoopbackPort();
  rootUrl = `http://127.0.0.1:${port}`;
  let bundledPython = false;
  try { accessSync(".venv/bin/python", constants.X_OK); bundledPython = true; } catch {}
  const python = process.env.PYTHON || (bundledPython ? ".venv/bin/python" : "python3");
  const child = spawn(python, ["-m", "synthesiser.web.server", "--port", String(port)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PYTHONPATH: "src" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errorText = "";
  child.stderr.on("data", chunk => { errorText += chunk; });
  child.on("error", error => { errorText += error.message; });
  for (let i = 0; i < 600; i++) {
    if (await serverReady()) return child;
    if (child.exitCode != null) throw new Error(`dev server exited (${child.exitCode}): ${errorText}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`timed out waiting for ${rootUrl}`);
}

function wavBytes(channels, sampleRate) {
  const channelCount = channels.length;
  const frames = channels[0]?.length || 0;
  const bytes = new ArrayBuffer(44 + frames * channelCount * 2);
  const view = new DataView(bytes);
  const ascii = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, frames * channelCount * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return Buffer.from(bytes);
}

async function paramsFor(job) {
  let base;
  if (job.params && typeof job.params === "object") base = job.params;
  const path = job.paramsFile || job.params;
  if (base == null) base = path ? JSON.parse(await readFile(path, "utf8")) : {};
  const override = job.paramsOverride && typeof job.paramsOverride === "object"
    ? job.paramsOverride : {};
  return { ...base, ...override };
}

async function renderJobs(jobs, { retainPcm = true } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${rootUrl}/index.html`, { waitUntil: "domcontentloaded" });
    const results = [];
    for (const job of jobs) {
      const baseParams = await paramsFor(job);
      const params = Number.isFinite(Number(job.seed))
        ? { ...baseParams, seed: Number(job.seed) }
        : baseParams;
      const rendered = await page.evaluate(async ({ params, options }) => {
        const { renderNoteOffline } = await import("/render-note.js");
        const buffer = await renderNoteOffline(params, options);
        return {
          sampleRate: buffer.sampleRate,
          channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => Array.from(buffer.getChannelData(i))),
        };
      }, { params, options: {
        midi: Number(job.midi ?? 60), velocity: Number(job.velocity ?? 0.62),
        durationSec: Number(job.durationSec ?? job.duration ?? 1.5),
        sampleRate: Number(job.sampleRate ?? 48000),
        preRollSec: Number(job.preRollSec ?? 0),
      } });
      const wav = wavBytes(rendered.channels, rendered.sampleRate);
      if (job.out) await writeFile(job.out, wav);
      const sha256 = createHash("sha256").update(wav).digest("hex");
      // Large campaign batches only consume the digest after each WAV has
      // been written. Retaining every decoded channel plus every encoded WAV
      // made memory scale with the entire batch (hundreds of long notes can
      // exhaust V8). Verification callers keep the PCM by default.
      results.push(retainPcm ? { ...rendered, wav, sha256 } : { sha256 });
    }
    return results;
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = await ensureServer();
  try {
    if (args.verify) {
      const job = { params: { spectralProfile: "clarinet", seed: 7331, spectralPartials: 32, spectralMix: 1 }, midi: 60, durationSec: 0.5, sampleRate: 24000 };
      const inertJob = {
        ...job,
        params: { ...job.params, polarisationAmount: 0,
          polarisationSplitCents: 6, polarisationDecayRatio: 4 },
      };
      const coupledJob = {
        ...job,
        params: { ...job.params, partialMaterial: 0.4, polarisationAmount: 1,
          polarisationSplitCents: 6, polarisationDecayRatio: 2 },
      };
      const bowBase = {
        params: { spectralProfile: "violin", excitationType: "bow", seed: 54054,
          spectralPartials: 32, spectralMix: 1, excitationHuman: 0,
          vibratoProb: 0, reverbWet: 0 },
        midi: 69, velocity: .62, durationSec: .75, sampleRate: 24000,
      };
      const bowZero = { ...bowBase,
        params: { ...bowBase.params, bowNoiseLevel: 0 } };
      const bowEnabled = { ...bowBase,
        params: { ...bowBase.params, bowNoiseLevel: 1 } };
      const mutedPartials = Array(64).fill(0);
      const breathBase = {
        params: { spectralProfile: "voice-mezzo", excitationType: "blow",
          seed: 61061, spectralPartials: 32, spectralMix: 1,
          spectralPartialMeans: mutedPartials, spectralPartialSds: mutedPartials,
          // A-VOICE-05 profile tables now win over legacy means. An explicit
          // empty surface selects the exact absent-table fallback so this
          // fixture continues to isolate breath-envelope synchrony.
          spectralPartialsByRegisterDynamic: { rows: [] },
          toneBreath: 1, breathLevelScale: 1, breathTurbulence: 0,
          breathBodyAmount: 0, excitationHuman: 0, vibratoProb: 0,
          envelopeAttack: .005, envelopeDecay: .01, envelopeSustain: 1,
          envelopeRelease: .02, reverbWet: 0 },
        midi: 57, velocity: .62, durationSec: .9, sampleRate: 24000,
      };
      const breathOmitted = breathBase;
      const breathZero = { ...breathBase,
        params: { ...breathBase.params, voiceBreathSync: 0 } };
      const breathSyncLow = { ...breathBase,
        params: { ...breathBase.params, voiceBreathSync: .8 } };
      const breathSyncHigh = { ...breathSyncLow, midi: 69 };
      const breathBody = { ...breathSyncLow,
        params: { ...breathSyncLow.params, breathBodyAmount: 1,
          bodyBands: [{ freq: 2200, gain: 2, width: .18 }] } };
      const windBase = {
        params: { spectralProfile: "flute", excitationType: "blow",
          seed: 171717, spectralPartials: 32, spectralMix: 1,
          toneBreath: .24, windBreathLevel: 0,
          breathLevelScale: 1, breathVelocityExponent: 1,
          breathTurbulence: 0, excitationHuman: 0, vibratoProb: 0,
          envelopeAttack: .28, envelopeDecay: .01, envelopeSustain: 1,
          envelopeRelease: .03, reverbWet: 0 },
        midi: 60, velocity: .2, durationSec: .9, sampleRate: 24000,
        preRollSec: .4,
      };
      const windOff = windBase;
      const windOn = { ...windBase,
        params: { ...windBase.params, windBreathLevel: 1 } };
      const l18Base = (excitationType, sustain) => ({
        params: { spectralProfile: excitationType === "strike" ? "piano" : "guitar",
          excitationType, seed: 18066, spectralPartials: 12, spectralMix: 1,
          excitationHuman: 0, vibratoProb: 0, polarisationAmount: 0,
          attackNoiseLevel: 0, envelopeAttack: .004, envelopeAttackSd: 0,
          envelopeDecay: .01, envelopeDecaySd: 0, envelopeSustain: sustain,
          envelopeSustainSd: 0, envelopeRelease: .02, reverbWet: 0 },
        midi: 60, velocity: .72, durationSec: 8, sampleRate: 12000,
      });
      const [a, b, inert, coupled, bowLegacy, bowOff, bowOnA, bowOnB,
        syncLegacy, syncZero, syncLow, syncHigh, syncBody,
        windSilent, windActiveA, windActiveB,
        strikeSustainLow, strikeSustainHigh, pluckSustainLow, pluckSustainHigh] =
        await renderJobs([job, job, inertJob, coupledJob,
          bowBase, bowZero, bowEnabled, bowEnabled,
          breathOmitted, breathZero, breathSyncLow, breathSyncHigh, breathBody,
          windOff, windOn, windOn,
          l18Base("strike", .05), l18Base("strike", 1),
          l18Base("pluck", .05), l18Base("pluck", 1)]);
      const pcmDiff = (left, right) => {
        let maxDiff = 0, meanDiff = 0, count = 0;
        for (let ch = 0; ch < left.channels.length; ch++) {
          for (let i = 0; i < left.channels[ch].length; i++) {
            const diff = Math.abs(left.channels[ch][i] - right.channels[ch][i]);
            maxDiff = Math.max(maxDiff, diff); meanDiff += diff; count++;
          }
        }
        return { maxDiff, meanDiff: meanDiff / Math.max(1, count) };
      };
      if (a.sha256 !== b.sha256) {
        const { maxDiff, meanDiff } = pcmDiff(a, b);
        // Chromium's OfflineAudioContext may differ by a few last-place float
        // bits between contexts because its DSP graph is evaluated in parallel.
        // Treat sub-16-bit differences as identical; anything audible or able
        // to move PCM by more than 1/32768 remains a hard failure.
        if (maxDiff > 1 / 32768) {
          throw new Error(`determinism failed: ${a.sha256} != ${b.sha256} (max PCM diff ${maxDiff}, mean ${meanDiff})`);
        }
      }
      const inactiveDiff = pcmDiff(a, inert);
      if (inactiveDiff.maxDiff > 1 / 32768) {
        throw new Error(`polarisation amount 0 changed PCM: max diff ${inactiveDiff.maxDiff}`);
      }
      const coupledEnergy = coupled.channels.reduce((total, channel) =>
        total + channel.reduce((sum, sample) => sum + sample * sample, 0), 0);
      if (!(coupledEnergy > 0) || !Number.isFinite(coupledEnergy)) {
        throw new Error(`polarisation render is silent/non-finite: ${coupledEnergy}`);
      }
      const bowOffDiff = pcmDiff(bowLegacy, bowOff);
      if (bowOffDiff.maxDiff > 1 / 32768) {
        throw new Error(`bowNoiseLevel 0 changed legacy PCM: max diff ${bowOffDiff.maxDiff}`);
      }
      const bowRepeatDiff = pcmDiff(bowOnA, bowOnB);
      if (bowRepeatDiff.maxDiff > 1 / 32768) {
        throw new Error(`seeded bow-noise render is not deterministic: max diff ${bowRepeatDiff.maxDiff}`);
      }
      const bowConsumerDiff = pcmDiff(bowOff, bowOnA);
      if (bowConsumerDiff.meanDiff <= 1e-7) {
        throw new Error(`pinned bow-noise consumer is silent: mean diff ${bowConsumerDiff.meanDiff}`);
      }
      const windRepeatDiff = pcmDiff(windActiveA, windActiveB);
      if (windRepeatDiff.maxDiff > 1 / 32768) {
        throw new Error(`seeded wind-breath component is not deterministic: max diff ${windRepeatDiff.maxDiff}`);
      }
      const windConsumerDiff = pcmDiff(windSilent, windActiveA);
      if (windConsumerDiff.meanDiff <= 1e-7) {
        throw new Error(`pinned wind-breath consumer is silent: mean diff ${windConsumerDiff.meanDiff}`);
      }
      const windToneT0 = windOn.preRollSec;
      const preEnd = Math.max(1, Math.floor((windToneT0 - .005) * windActiveA.sampleRate));
      let preEnergy = 0, offPreEnergy = 0;
      for (let i = 0; i < preEnd; i++) {
        preEnergy += windActiveA.channels[0][i] ** 2;
        offPreEnergy += windSilent.channels[0][i] ** 2;
      }
      if (!(windToneT0 > .02 && preEnergy > Math.max(1e-10, offPreEnergy * 4))) {
        throw new Error(`L17 wind component did not audibly precede harmonic t0: lead ${windToneT0}, on ${preEnergy}, off ${offPreEnergy}`);
      }
      const holdMetrics = (render) => {
        const samples = render.channels[0], sr = render.sampleRate;
        const window = Math.round(.25 * sr);
        const levels = [];
        for (let start = Math.round(.25 * sr); start + window < Math.min(samples.length, 7.9 * sr); start += window) {
          let energy = 0;
          for (let i = start; i < start + window; i++) energy += samples[i] ** 2;
          levels.push(10 * Math.log10(Math.max(1e-20, energy / window)));
        }
        const peak = Math.max(...levels);
        const active = levels.filter(level => level >= peak - 60);
        const slopes = active.slice(1).map((level, index) =>
          (level - active[index]) / .25);
        return {
          slopeDbPerSecond: (active[active.length - 1] - active[0]) /
            Math.max(.25, (active.length - 1) * .25),
          plateauFraction: slopes.filter(slope => Math.abs(slope) <= .15).length /
            Math.max(1, slopes.length),
        };
      };
      for (const [type, low, high] of [["strike", strikeSustainLow, strikeSustainHigh],
        ["pluck", pluckSustainLow, pluckSustainHigh]]) {
        const identity = pcmDiff(low, high);
        if (identity.maxDiff > 1 / 32768) {
          throw new Error(`L18 ${type} envelopeSustain changed PCM: ${JSON.stringify(identity)}`);
        }
        const hold = holdMetrics(low);
        if (!(hold.slopeDbPerSecond <= -.3 && hold.plateauFraction < .5)) {
          throw new Error(`L18 ${type} rendered hold plateau: ${JSON.stringify(hold)}`);
        }
      }
      const syncZeroDiff = pcmDiff(syncLegacy, syncZero);
      if (syncZeroDiff.maxDiff > 1 / 32768) {
        throw new Error(`A-VOICE-04 sync zero changed legacy blow-floor PCM: max diff ${syncZeroDiff.maxDiff}`);
      }
      const envelopeTone = (render, frequency) => {
        const samples = render.channels[0], sr = render.sampleRate;
        const start = Math.floor(.16 * sr), end = Math.min(samples.length, Math.floor(.76 * sr));
        let mean = 0;
        for (let i = start; i < end; i++) mean += Math.abs(samples[i]);
        mean /= Math.max(1, end - start);
        let real = 0, imag = 0;
        for (let i = start; i < end; i++) {
          const value = Math.abs(samples[i]) - mean;
          const phase = 2 * Math.PI * frequency * (i - start) / sr;
          real += value * Math.cos(phase); imag -= value * Math.sin(phase);
        }
        return Math.hypot(real, imag) / Math.max(1, end - start);
      };
      const lowHz = 440 * 2 ** ((57 - 69) / 12);
      const highHz = lowHz * 2;
      const lowLine = envelopeTone(syncLow, lowHz);
      const lowSide = Math.max(envelopeTone(syncLow, lowHz - 20),
        envelopeTone(syncLow, lowHz + 20));
      const zeroLine = envelopeTone(syncZero, lowHz);
      if (!(lowLine >= 2 * lowSide && lowLine >= 2 * zeroLine)) {
        const syncDiff = pcmDiff(syncZero, syncLow);
        throw new Error(`A-VOICE-04 tracked envelope line below 6 dB gate: line ${lowLine}, side ${lowSide}, zero ${zeroLine}, diff ${JSON.stringify(syncDiff)}`);
      }
      let bestHigh = { frequency: 0, magnitude: -Infinity };
      for (let frequency = highHz * .98; frequency <= highHz * 1.02; frequency += .25) {
        const magnitude = envelopeTone(syncHigh, frequency);
        if (magnitude > bestHigh.magnitude) bestHigh = { frequency, magnitude };
      }
      let bestLow = { frequency: 0, magnitude: -Infinity };
      for (let frequency = lowHz * .98; frequency <= lowHz * 1.02; frequency += .25) {
        const magnitude = envelopeTone(syncLow, frequency);
        if (magnitude > bestLow.magnitude) bestLow = { frequency, magnitude };
      }
      if (Math.abs(bestHigh.frequency / bestLow.frequency - 2) > .02) {
        throw new Error(`A-VOICE-04 modulation peak does not octave-track: ${bestLow.frequency} -> ${bestHigh.frequency}`);
      }
      const bodyDiff = pcmDiff(syncLow, syncBody);
      if (bodyDiff.meanDiff <= 1e-6) {
        throw new Error(`A-VOICE-04 body route is not audible: mean diff ${bodyDiff.meanDiff}`);
      }
      let bestBody = { frequency: 0, magnitude: -Infinity };
      for (let frequency = lowHz * .98; frequency <= lowHz * 1.02; frequency += .25) {
        const magnitude = envelopeTone(syncBody, frequency);
        if (magnitude > bestBody.magnitude) bestBody = { frequency, magnitude };
      }
      if (Math.abs(bestBody.frequency / bestLow.frequency - 1) > .02) {
        throw new Error(`A-VOICE-04 body route moved pulse frequency: ${bestLow.frequency} -> ${bestBody.frequency}`);
      }
      const left = a.channels[0], right = a.channels[1];
      let delta = 0, energy = 0;
      for (let i = 0; i < left.length; i++) { delta += Math.abs(left[i] - right[i]); energy += Math.abs(left[i]); }
      // A frontal transparent listener should be effectively mono. WebAudio's
      // two independently evaluated ear branches can differ at the sub-percent
      // level, so keep a conservative 1% energy tripwire.
      if (delta > Math.max(1e-7, energy * 0.01)) throw new Error(`neutral-space stereo mismatch: ${delta / Math.max(energy, 1e-9)}`);
      console.log(`render-note verify ok ${a.sha256}`);
      return;
    }
    let jobs;
    if (args.batch) {
      jobs = JSON.parse(await readFile(args.batch, "utf8"));
      if (!Array.isArray(jobs)) usage("--batch must contain a JSON array");
    } else {
      if (!args.params || !args.out) usage("--params and --out are required");
      jobs = [{ paramsFile: args.params, out: args.out, midi: args.midi, velocity: args.velocity,
        durationSec: args.duration, sampleRate: args["sample-rate"] }];
    }
    const started = performance.now();
    const results = await renderJobs(jobs, { retainPcm: !args.batch });
    console.log(JSON.stringify({ renders: results.length, elapsedSec: (performance.now() - started) / 1000,
      outputs: jobs.map((job, i) => ({ out: job.out, sha256: results[i].sha256 })) }, null, 2));
  } finally {
    if (server) server.kill();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
