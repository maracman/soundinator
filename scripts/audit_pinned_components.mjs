#!/usr/bin/env node

// L17 preset-level ship gate. A measured component may have an exact-neutral
// engine control, but no SHIP preset that selects its excitation is allowed to
// leave it neutral or bypass its independent envelope.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  pinnedNoiseActivationReport,
  SPECTRAL_PROFILES,
} from "../web/static/synth.js";

function usage(message = "") {
  if (message) console.error(message);
  console.error("usage: node scripts/audit_pinned_components.mjs --params FILE [--out FILE]");
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--")) usage(`unexpected argument ${key}`);
    const value = argv[++index];
    if (value == null) usage(`missing value for ${key}`);
    args[key.slice(2)] = value;
  }
  if (!args.params) usage("--params is required");
  return args;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, canonical(value[key])]));
  }
  return value;
}

const args = parseArgs(process.argv.slice(2));
const paramsPath = resolve(args.params);
const payload = JSON.parse(await readFile(paramsPath, "utf8"));
const params = payload?.params && typeof payload.params === "object"
  ? payload.params : payload;
const profileKey = String(params.spectralProfile || "");
const rows = pinnedNoiseActivationReport(SPECTRAL_PROFILES[profileKey], params, true);
const applicable = rows.filter(row => row.applicable);
const failures = applicable.filter(row => !row.active);
const report = {
  schema: "sg2-pinned-component-activation-v1",
  mode: "ship",
  paramsFile: paramsPath,
  paramsHash: createHash("sha256")
    .update(JSON.stringify(canonical(params))).digest("hex"),
  spectralProfile: profileKey,
  excitationType: String(params.excitationType || ""),
  components: rows,
  passed: applicable.length > 0 && failures.length === 0,
  failure: applicable.length === 0
    ? "preset has no applicable pinned component"
    : failures.length ? "one or more applicable pinned components are inactive" : null,
};
if (args.out) await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
