/**
 * The Producer's resolution law — DOM-free so it can be asserted headlessly.
 *
 * One question, one answer: given an arrangement, a thread and a take, WHICH
 * TIER OWNS EACH MODULE and what does the engine finally receive? Every
 * surface in the Producer (playback, mixdown, the inspector, the thread head)
 * must agree, so they all come through here.
 *
 * The tiers, in order:
 *
 *   DEFAULTS → session context (tempo)
 *            → palette patch params
 *            → region.overrides[part]     per-module; only the diverged ones
 *            → region.seed
 *            → Harmonic guide             claims `clef` on threads that opted
 *                                         in, GENERATIVE takes only
 *            → Global space               claims `space` on threads that opted
 *                                         in: their position MOVES along a
 *                                         path, and they share the listener
 *                                         and room (unless spaceOwnHead)
 *
 * The two globals are LATERAL CLAIMS on named modules, not a top tier —
 * nothing outside `clef` and `space` is claimable by them. Both are PER
 * THREAD: `useGlobalScale` and `useGlobalSpace`. A thread outside the global
 * space still has a position (its own static one); joining does not give it a
 * position, it gives that position movement over time.
 */

import {
  DEFAULTS,
  migrateParamsShape,
  serializeParams,
  capturePartsFor,
  applyModule,
  divergedModules,
  CAPTURE_PARTS,
} from "./params.js";
import { trackSpaceAt, globalScaleAt, SCALE_PRESETS } from "./synth.js";

// Only the transport belongs to the session. Scale, dynamics, space and
// percussion are all editable parts of a patch; the globals claim them later
// and visibly, rather than the session owning them invisibly.
export const SESSION_CONTEXT_PARAMS = new Set(["seed", "tempo"]);

export function defaultArrangementContext() {
  const ctx = {};
  for (const key of SESSION_CONTEXT_PARAMS) {
    if (key !== "seed" && key in DEFAULTS) ctx[key] = DEFAULTS[key];
  }
  ctx.customDegrees = [...(SCALE_PRESETS[ctx.scalePreset]?.degrees || SCALE_PRESETS.major.degrees)];
  ctx.reverbWet = 0.16;
  return ctx;
}

// ── Spatial constellation maths ─────────────────────────────
// A patch with layers is a CONSTELLATION of sources. The thread carries one
// GROUP HANDLE for the whole constellation; these are the pure transforms
// shared by playback and every canvas, so what you see is what you hear.

/** Circular-mean angle + mean distance of a constellation. */
export function spCentroid(sources) {
  let sx = 0, sy = 0, sd = 0;
  for (const s of sources) {
    const a = (s.angle ?? 0) * Math.PI / 180;
    sx += Math.sin(a);
    sy += Math.cos(a);
    sd += s.dist ?? 2.5;
  }
  const angle = (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) ? Math.atan2(sx, sy) * 180 / Math.PI : 0;
  return { angle, dist: sd / Math.max(1, sources.length) };
}

/** Every source a patch sounds from: base + sound layers + percussion hits. */
export function spTrackSources(vp) {
  if (vp?.layers?.[0]?.sound) {
    const base = vp.layers[0]?.space || { angle: 0, dist: 2.5 };
    const sources = vp.layers.map(layer => ({
      angle: layer.space?.angle ?? base.angle,
      dist: layer.space?.dist ?? base.dist,
    }));
    for (const layer of Array.isArray(vp.percLayers) ? vp.percLayers : []) {
      sources.push({ angle: layer.space?.angle ?? base.angle, dist: layer.space?.dist ?? base.dist });
    }
    return sources;
  }
  const base = { angle: vp.spaceAzimuth ?? 0, dist: vp.spaceDistance ?? 2.5 };
  const sources = [base];
  for (const l of Array.isArray(vp.layers) ? vp.layers : []) {
    sources.push({ angle: l.space?.angle ?? base.angle, dist: l.space?.dist ?? base.dist });
  }
  for (const l of Array.isArray(vp.percLayers) ? vp.percLayers : []) {
    sources.push({ angle: l.space?.angle ?? base.angle, dist: l.space?.dist ?? base.dist });
  }
  return sources;
}

export function spIsMulti(vp) { return spTrackSources(vp).length > 1; }

/**
 * The sources you can actually HEAR, for drawing. spTrackSources stays
 * positional because the placement law maps its output back onto layers by
 * index — filtering there would misplace everything. This is the display list:
 * mute and solo applied, so a silenced layer does not sit in the room looking
 * like it is sounding.
 *
 * Solo semantics match layerMixPlan: any solo anywhere silences everything not
 * soloed; otherwise everything not muted sounds.
 */
export function spVisibleSources(vp) {
  const unified = !!vp?.layers?.[0]?.sound;
  const layers = Array.isArray(vp?.layers) ? vp.layers : [];
  const perc = Array.isArray(vp?.percLayers) ? vp.percLayers : [];
  const base = unified
    ? (layers[0]?.space || { angle: 0, dist: 2.5 })
    : { angle: vp?.spaceAzimuth ?? 0, dist: vp?.spaceDistance ?? 2.5 };

  const tonal = unified
    ? layers.map((l, i) => ({ layer: l, i }))
    : [{ layer: { space: base, solo: vp?.baseLayerSolo, mute: false }, i: 0 },
       ...layers.map((l, i) => ({ layer: l, i: i + 1 }))];
  const anySolo = tonal.some(({ layer }) => layer?.solo);

  const out = [];
  for (const { layer, i } of tonal) {
    if (anySolo ? !layer?.solo : layer?.mute) continue;
    out.push({ kind: "layer", index: i,
      angle: layer?.space?.angle ?? base.angle, dist: layer?.space?.dist ?? base.dist });
  }
  // A soloed sound layer silences the hits too — they are not part of the solo.
  if (!anySolo) {
    for (const l of perc) {
      if (l?.mute || !((Number(l?.vol) || 0) > 0)) continue;
      out.push({ kind: "percussion",
        angle: l?.space?.angle ?? base.angle, dist: l?.space?.dist ?? base.dist });
    }
  }
  return out;
}

/**
 * Apply the group handle to a constellation.
 *   centered — the handle rides the constellation's centre: rotate every
 *     source together, scale every distance by handle/centroid (so distances
 *     can never go negative).
 *   additive — the handle is a translation from the listener: every source
 *     shifts by the same vector.
 */
export function spTransformSources(sources, handle, mode) {
  if (mode === "additive") {
    const ha = (handle.angle ?? 0) * Math.PI / 180;
    const hd = Math.max(0, handle.dist ?? 0);
    const tx = Math.sin(ha) * hd, tz = Math.cos(ha) * hd;
    return sources.map(s => {
      const a = (s.angle ?? 0) * Math.PI / 180;
      const d = s.dist ?? 2.5;
      const x = Math.sin(a) * d + tx, z = Math.cos(a) * d + tz;
      return { angle: Math.atan2(x, z) * 180 / Math.PI, dist: Math.min(30, Math.hypot(x, z)) };
    });
  }
  const cen = spCentroid(sources);
  const dA = (handle.angle ?? cen.angle) - cen.angle;
  const k = Math.max(0.02, handle.dist ?? cen.dist) / Math.max(0.05, cen.dist);
  return sources.map(s => {
    let a = (s.angle ?? 0) + dA;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    return { angle: a, dist: Math.max(0.05, Math.min(30, (s.dist ?? 2.5) * k)) };
  });
}

/**
 * Move a whole patch by a group handle. THE one placement law — used by the
 * global-space thread and by the thread head's own dot, so a track's position
 * means the same thing whether or not the global space is switched on.
 */
export function spApplyThreadToPatch(params, handle) {
  const sources = spTrackSources(params);
  const mode = params.spaceMovement === "additive" ? "additive" : "centered";
  const out = spTransformSources(sources, handle, mode);
  let at = 0;
  if (params?.layers?.[0]?.sound) {
    params.layers = params.layers.map(l => ({
      ...l, space: { angle: out[at].angle, dist: Math.max(0.3, out[at++].dist) },
    }));
  } else {
    params.spaceAzimuth = out[0].angle;
    params.spaceDistance = Math.max(0.3, out[0].dist);
    at = 1;
    if (Array.isArray(params.layers)) {
      params.layers = params.layers.map(l => ({
        ...l, space: { angle: out[at].angle, dist: Math.max(0.3, out[at++].dist) },
      }));
    }
  }
  if (Array.isArray(params.percLayers)) {
    params.percLayers = params.percLayers.map(l => ({
      ...l, space: { angle: out[at].angle, dist: Math.max(0.3, out[at++].dist) },
    }));
  }
  return params;
}

// ── Patch / take resolution ─────────────────────────────────

/** A thread's own static placement, if it has been given one. */
export function staticTrackPos(track) {
  const own = track?.space;
  if (!own || (!Number.isFinite(own.angle) && !Number.isFinite(own.dist))) return null;
  return { angle: own.angle ?? 0, dist: own.dist ?? 2.5 };
}

/**
 * Which change point governs this beat, as a stable id. The playback loop
 * compares it beat to beat: when it moves, threads following the guide need
 * their live voices re-pointed at the new scale mid-note.
 */
export function harmonicMarkerIdAt(arrangement, beat) {
  const marker = globalScaleAt({ ...(arrangement?.globalScale || {}), enabled: true }, beat ?? 0);
  return marker ? String(marker.atBeat ?? 0) : "";
}

/** Is this thread's position animated along a path in the global space? */
export function threadInGlobalSpace(track) { return !!track?.useGlobalSpace; }

/** A percussion-only patch: hits but no pitched source. */
export function isPercussionOnlyPatch(pl) {
  const parts = capturePartsFor(pl?.params || {}, "full", pl?.captureParts);
  return !!parts.percussion && !parts.notes;
}

export function palettePatchFor(arrangement, region) {
  return (arrangement?.palette || []).find(pl => pl.id === region?.paletteId) || null;
}

/**
 * The take's voice: its palette patch with ONLY the modules it has actually
 * diverged on applied over the top. Everything else keeps following the patch
 * live — that is what lets one sound edit reach every take at once, including
 * baked ones.
 *
 * `paramsOverride` is the pre-2026-07-28 whole-patch fork, still read so old
 * arrangements sound the same until normaliseArrangement migrates them.
 */
export function regionVoiceParams(arrangement, track, region) {
  const pal = palettePatchFor(arrangement, region);
  const overrides = region?.overrides;
  if (overrides && typeof overrides === "object" && Object.keys(overrides).length) {
    let params = pal ? pal.params : (region.paramsOverride || track?.instrumentParams || {});
    for (const part of CAPTURE_PARTS) {
      if (overrides[part]) params = applyModule(params, part, overrides[part]);
    }
    return migrateParamsShape(params);
  }
  if (region?.paramsOverride) return migrateParamsShape(region.paramsOverride);
  return migrateParamsShape(pal ? pal.params : (track?.instrumentParams || {}));
}

/** Which modules this take has taken into its own hands. */
export function regionOverriddenParts(region) {
  const overrides = region?.overrides || {};
  return CAPTURE_PARTS.filter(part => overrides[part]);
}

/**
 * Everything the engine needs to play one take, with every tier resolved.
 * `atBeat` lets the space thread be sampled where the playhead actually is
 * rather than at the region start, so movement is continuous during playback.
 */
export function regionPlayParams(arrangement, track, region, atBeat = null) {
  const context = arrangement?.context || defaultArrangementContext();
  const params = migrateParamsShape({
    ...DEFAULTS, ...context, ...regionVoiceParams(arrangement, track, region), seed: region.seed,
  });

  // A percussion-only patch keeps the note grid (it drives hit timing) while
  // the pitched voice stays silent.
  const srcPatch = palettePatchFor(arrangement, region);
  if (region.percussionOnly || (srcPatch && isPercussionOnlyPatch(srcPatch))) params.percussionOnly = true;

  // ── Harmonic guide claims `clef` ──
  // Opting the thread in IS the activation; there is no separate enable.
  //
  // The marker in force AT THIS BEAT, not at the take's start (owner
  // 2026-07-28): a take that was already sounding when a change point arrives
  // has to turn with it, otherwise the guide only ever reaches takes that
  // happen to begin after it and a held note ignores the modulation under it.
  //
  // BAKED TAKES ARE EXEMPT: a marker carrying edoDivisions would re-pitch
  // every stored degree, because degreeToHz is tonicHz·2^(degree/div).
  // Bake means frozen.
  if (track?.useGlobalScale && region.type !== "baked") {
    const marker = globalScaleAt({ ...(arrangement?.globalScale || {}), enabled: true },
      atBeat ?? region.startBeat ?? 0);
    if (marker) {
      if (marker.scaleMode) params.scaleMode = marker.scaleMode;
      if (Number.isFinite(marker.edoDivisions)) params.edoDivisions = marker.edoDivisions;
      params.customDegrees = [...marker.degrees];
      params.subScaleNotes = [...(marker.subScaleNotes || [])];
      params.rootNotes = [...(marker.rootNotes || [0])];
    }
  }

  // ── Where this thread sits ──
  // The thread position is ALWAYS live: it is one group handle over the
  // patch's whole constellation, applied through the same law either way.
  // Joining the global space does not give a thread a position — it makes
  // that position MOVE OVER TIME along a path, exactly as the Harmonic guide
  // makes a scale change over time. Opted out, the dot sets a static place.
  const sp = arrangement?.space;
  const inGlobal = !!track?.useGlobalSpace;
  const threadPos = inGlobal
    ? (trackSpaceAt(sp?.tracks?.[track.id], atBeat ?? region.startBeat ?? 0) || sp?.static?.[track.id] || staticTrackPos(track))
    : staticTrackPos(track);
  if (threadPos) spApplyThreadToPatch(params, threadPos);

  // The shared listener and room come with joining the space — a thread that
  // sits outside it keeps its patch's own room.
  if (inGlobal && sp?.head && !params.spaceOwnHead) {
    const head = sp.head;
    if (Number.isFinite(head.earDistance)) params.earDistance = head.earDistance;
    if (Number.isFinite(head.headDensity)) params.headDensity = head.headDensity;
    if (Number.isFinite(head.pinnaScale)) params.pinnaScale = head.pinnaScale;
    if (head.earModel) params.earModel = head.earModel;
    if (head.reverbType) {
      params.reverbType = head.reverbType;
      // The shared room's design rides with its type: values the designer has
      // not set fall back to THAT room's character, not the patch's.
      params.reverbSize = head.reverbSize ?? null;
      params.reverbDamping = head.reverbDamping ?? null;
      params.reverbDiffusion = head.reverbDiffusion ?? null;
    }
    if (Number.isFinite(head.reverbWet)) params.reverbWet = head.reverbWet;
    if (Number.isFinite(head.reverbDecay)) params.reverbDecay = head.reverbDecay;
    // Head yaw: turning the listener rotates every source's bearing relative
    // to the ears — world sources stay put, but what you HEAR shifts.
    const facing = Number(head.facing) || 0;
    if (facing) {
      const rot = (a) => { const v = (Number(a) || 0) - facing; return ((v + 180) % 360 + 360) % 360 - 180; };
      params.spaceAzimuth = rot(params.spaceAzimuth);
      if (Array.isArray(params.layers)) params.layers = params.layers.map(l => l?.space ? { ...l, space: { ...l.space, angle: rot(l.space.angle) } } : l);
      if (Array.isArray(params.percLayers)) params.percLayers = params.percLayers.map(l => l?.space ? { ...l, space: { ...l.space, angle: rot(l.space.angle) } } : l);
    }
  }
  return params;
}

// ── Variants ────────────────────────────────────────────────
// A variant is an ordinary palette entry carrying a parent and the list of
// modules that differ from it. Flat by construction: a variant's parent is
// always a root patch, so the rack is two levels deep however long you work.

export function paletteById(arrangement, id) {
  return (arrangement?.palette || []).find(p => p.id === id) || null;
}

/** The root a variant hangs from (or the patch itself). */
export function rootPatchOf(arrangement, pl) {
  return pl?.parentId ? (paletteById(arrangement, pl.parentId) || pl) : pl;
}

export function paletteVariantsOf(arrangement, patchId) {
  return (arrangement?.palette || []).filter(p => p.parentId === patchId);
}

/**
 * Which modules a variant ACTUALLY differs from its parent on, computed now
 * rather than trusted from creation time. The stored `variantParts` is only a
 * fallback for an orphan: edit a variant after making it and the stored list
 * goes stale, so the row would keep advertising the original diff and quietly
 * hide the new one.
 */
export function variantDiffParts(arrangement, pl) {
  if (!pl?.parentId) return [];
  const parent = paletteById(arrangement, pl.parentId);
  if (!parent) return pl.variantParts || [];
  return divergedModules(parent.params, pl.params);
}

/** Every take playing this exact palette entry. */
export function takesOfPatch(arrangement, patchId) {
  const out = [];
  for (const track of arrangement?.tracks || []) {
    for (const region of track.regions || []) {
      if (region.paletteId === patchId) out.push({ track, region });
    }
  }
  return out;
}

/** Takes that have taken a module into their own hands. */
export function divergedTakesOfPatch(arrangement, patchId) {
  return takesOfPatch(arrangement, patchId).filter(({ region }) => regionOverriddenParts(region).length);
}

/** A variant is named for what it CHANGES — never "v2". */
export function variantLabel(params, parts) {
  const names = parts.map(part => MODULE_SHORT_NAME[part]?.(params)).filter(Boolean);
  return names.length ? names.join(" + ") : "Variant";
}

// Kept deliberately terse: these become row labels in a narrow rack.
const MODULE_SHORT_NAME = {
  notes: p => p.spectralProfileName || p.spectralProfile || "Sound",
  space: p => (Number.isFinite(p.spaceDistance) ? `${Number(p.spaceDistance).toFixed(1)} m` : (p.reverbType || "Space")),
  stave: p => `${p.melodyPattern || "Note"} engine`,
  clef: p => (p.scaleMode === "edo"
    ? `${p.edoDivisions || 12}-EDO`
    : (SCALE_PRESETS[p.scalePreset]?.label || p.scalePreset || "Scale")),
  percussion: p => {
    const first = (p.percLayers || []).map(l => l?.sound?.name || l?.sound?.key).filter(Boolean)[0];
    return first ? `${first} kit` : "Percussion";
  },
};

/**
 * What keeping this take's edits would produce: the resolved patch and the
 * modules that differ from its ROOT. `parts: []` means nothing actually
 * differs, so no variant should be created at all.
 */
export function variantForTake(arrangement, track, region) {
  const current = palettePatchFor(arrangement, region);
  if (!current) return null;
  const root = rootPatchOf(arrangement, current);
  const params = serializeParams(regionVoiceParams(arrangement, track, region));
  const parts = divergedModules(root.params, params);
  return { root, params, parts, label: variantLabel(params, parts) };
}

/**
 * Variants that no longer differ from their parent, as [variantId, parentId].
 * This is what stops the rack filling up when you edit and then edit back.
 */
export function redundantVariants(arrangement) {
  const out = [];
  for (const pl of arrangement?.palette || []) {
    if (!pl.parentId) continue;
    const parent = paletteById(arrangement, pl.parentId);
    if (!parent) continue;
    if (divergedModules(parent.params, pl.params).length) continue;
    out.push([pl.id, parent.id]);
  }
  return out;
}

/**
 * Which takes would follow if this module were pushed up into the patch, and
 * which would not because they hold their own edit of it. Nothing is allowed
 * to silently not-happen.
 */
export function applyModulePlan(arrangement, region, part) {
  const current = palettePatchFor(arrangement, region);
  if (!current) return { follow: [], keepOwn: [] };
  const target = rootPatchOf(arrangement, current);
  const follow = [], keepOwn = [];
  for (const entry of takesOfPatch(arrangement, target.id)) {
    if (entry.region === region) continue;
    (entry.region.overrides?.[part] ? keepOwn : follow).push(entry);
  }
  return { follow, keepOwn, target };
}

// ── Who owns what ───────────────────────────────────────────

/**
 * The authority over one module of one take. Single source of truth for every
 * "this is superseded" affordance in the UI, so a greyed control and the audio
 * can never disagree.
 *
 * owner: "patch" | "variant" | "take" | "harmonic-guide" | "global-space" | "bake"
 */
export function moduleAuthority(arrangement, track, region, part) {
  const pal = palettePatchFor(arrangement, region);
  const patchLabel = pal?.name || "patch";

  if (part === "clef") {
    if (region?.type === "baked") {
      return { owner: "bake", superseded: true, label: "Frozen by bake",
        reason: "Baked notes keep the scale they were baked under. The Harmonic guide does not reach frozen material." };
    }
    if (track?.useGlobalScale) {
      return { owner: "harmonic-guide", superseded: true, label: "Harmonic guide",
        reason: `Scale comes from the Harmonic guide marker in force at bar ${Math.floor((region?.startBeat ?? 0) / 4) + 1}.` };
    }
  }

  if (part === "space" && track?.useGlobalSpace) {
    return { owner: "global-space", superseded: true, label: "Global space",
      reason: "This thread follows a path in the global space — its position moves over time, and it shares the arrangement's listener and room." };
  }

  if (part === "stave" && region?.type === "baked") {
    return { owner: "bake", superseded: true, label: "Frozen by bake",
      reason: "Pitch, rhythm, dynamics and surprise are frozen into notes. Tempo and note connection still apply." };
  }

  if (region?.overrides?.[part]) {
    return { owner: "take", superseded: false, label: "This take",
      reason: `Edited on this take only — ${patchLabel} is unchanged.` };
  }

  if (pal?.parentId) {
    return { owner: "variant", superseded: false, label: pal.name || "Variant",
      reason: "This take plays a variant of its patch." };
  }

  return { owner: "patch", superseded: false, label: patchLabel, reason: "" };
}
