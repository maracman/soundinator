#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT_URL = process.env.SG2_URL || "http://127.0.0.1:8765";

function usage(message = "") {
  if (message) console.error(message);
  console.error(`Usage:
  node scripts/render_note.mjs --params sound.json --midi 60 --out note.wav [--velocity .62] [--duration 1.5] [--sample-rate 48000]
  node scripts/render_note.mjs --batch jobs.json
  node scripts/render_note.mjs --verify

Batch JSON is an array of {params|paramsFile,midi,velocity,durationSec,sampleRate,out}.`);
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
  try {
    const response = await fetch(`${ROOT_URL}/index.html`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverReady()) return null;
  let bundledPython = false;
  try { accessSync(".venv/bin/python", constants.X_OK); bundledPython = true; } catch {}
  const python = process.env.PYTHON || (bundledPython ? ".venv/bin/python" : "python3");
  const child = spawn(python, ["-m", "synthesiser.web.server"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PYTHONPATH: "src" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errorText = "";
  child.stderr.on("data", chunk => { errorText += chunk; });
  child.on("error", error => { errorText += error.message; });
  for (let i = 0; i < 100; i++) {
    if (await serverReady()) return child;
    if (child.exitCode != null) throw new Error(`dev server exited (${child.exitCode}): ${errorText}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`timed out waiting for ${ROOT_URL}`);
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
  if (job.params && typeof job.params === "object") return job.params;
  const path = job.paramsFile || job.params;
  if (!path) return {};
  return JSON.parse(await readFile(path, "utf8"));
}

async function renderJobs(jobs) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${ROOT_URL}/index.html`, { waitUntil: "domcontentloaded" });
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
      } });
      const wav = wavBytes(rendered.channels, rendered.sampleRate);
      if (job.out) await writeFile(job.out, wav);
      results.push({ ...rendered, wav, sha256: createHash("sha256").update(wav).digest("hex") });
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
      const [a, b, inert, coupled] = await renderJobs([job, job, inertJob, coupledJob]);
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
    const results = await renderJobs(jobs);
    console.log(JSON.stringify({ renders: results.length, elapsedSec: (performance.now() - started) / 1000,
      outputs: jobs.map((job, i) => ({ out: job.out, sha256: results[i].sha256 })) }, null, 2));
  } finally {
    if (server) server.kill();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
