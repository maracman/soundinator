// Effect module roster — host-owned. Each import is one self-contained
// effect face + DSP (docs/EFFECTS_CONTRACT.md).
import { registerEffect } from "./registry.js";

import sculptEq from "./sculpt-eq.js";
import tubeDrive from "./tube-drive.js";
import wavefolder from "./wavefolder.js";
import tremolo from "./tremolo.js";
import phaser from "./phaser.js";
import ensembleChorus from "./ensemble-chorus.js";
import ringMod from "./ring-mod.js";
import tapeEcho from "./tape-echo.js";
import patternDelay from "./pattern-delay.js";
import vinyl from "./vinyl.js";
import springReverb from "./spring-reverb.js";

for (const mod of [
  sculptEq,       // Filter & EQ
  tubeDrive,      // Drive & Dirt
  wavefolder,     // Drive & Dirt
  tremolo,        // Modulation
  phaser,         // Modulation
  ensembleChorus, // Modulation
  ringMod,        // Modulation
  tapeEcho,       // Delay & Echo
  patternDelay,   // Delay & Echo
  vinyl,          // Character
  springReverb,   // Character
]) registerEffect(mod);

export * from "./registry.js";
