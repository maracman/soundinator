# Terminology — what every user-facing word means (Q11 vocabulary audit)

One row per term the interface uses. Research-side identifiers
(`stimulus_id`, schema versions, `APP_VERSION`) are protocol, not UI —
they never rename.

| Term | Meaning | Where it appears |
|---|---|---|
| **Sound Studio** | The whole app: studio + producer | title bar, welcome card |
| **Macro** | The behaviour half of a patch: melody, rhythm, dynamics, sequence & surprise | studio workspace tab (hover explains) |
| **Sub-note** | The instrument designer: what one note sounds like (excitor → resonator → body → space) | studio workspace tab (hover explains) |
| **Producer** | Timeline arranger: tracks, regions, palette | third workspace tab |
| **Tone print** | The instrument's partial set as the engine truly renders it (was "fingerprint" in older copy — now consistent) | CHORDA field, PARAM_DESC |
| **Excitor / Resonator / Body / Space** | The four stages of the tone chain: what drives it, what rings, what colours it, where it stands | CHORDA rail cards 01–04 |
| **Patch** | One palette entry: a complete voice = macro engine + subnote module | producer palette |
| **Region / take** | A block on a track lane; a *take* is generative (seed) until *baked* into notes | timeline, toolbar |
| **Seed** | The identity of a take: the same seed always regenerates the same music | region chips (`s·NNN`), toolbar |
| **Bake (◆)** | Freeze a take into editable per-note data (opens the piano roll) | region toolbar |
| **Splits** | Scale degrees per octave (5 for pentatonic, 7 for major/dorian, N for N-EDO subsets) | patch badges, browser filter |
| **Grid** | Subdivisions per beat (`beatDivisions`) | patch badges, roll header |
| **Surprise (✦)** | The expectancy-violation system; letters P·T·R·F·D name its dimensions (Pitch, Tuning, Rhythm, Formant, Dynamics) + rest | macro tab, patch badges |
| **Incorporated** | A surprise the motif has absorbed — it stops being surprising and becomes the pattern | roll readout (shipped earlier) |
| **Sub-scale** | The weighted subset of scale degrees the walk prefers (gold rows) | scale cards, global scale mini-roll |
| **Root** | Degrees the melody is pulled toward (violet rows) | scale cards, mini-roll |
| **Glide / Ring** | What overlapping notes do: slide mono-legato, or keep both sounding | note connection control, patch badges |
| **Layers** | Extra subnote modules stacked on one instrument, each with level and position | sub-note strip (Q7) |
| **Global scale** | Timeline markers opted-in tracks regenerate under (G button) | producer strip (Q5) |
| **Global space** | Timeline threads positioning every track around the listener | producer strip (Q6) |
| **Ear span / Head density** | The listener's head: interaural distance; how strongly the head shadows the far ear | SPACE inspector, space designer |
| **Key (root pitch)** | The pitch class degree 0 lands on — transposes the whole lattice | session bars (renamed from "Key") |
| **Human** | The imperfection dial: scoop, wander, fluctuation all scale with it | EXCITOR inspector |

## Renames applied in this audit

- "fingerprint" → **"tone print"** in every user-facing string (5 sites:
  `spectralMix`/`spectralPartials`/`cvHarmonicSignature` descriptions and
  two section explainers). Code identifiers (`_spectralFingerprint`)
  unchanged — they are internal.
- "Key" → **"Key (root pitch)"** in both session bars (Q9 F).
- "stimulus": confirmed **never user-facing** (only comments and the
  `stimulus_id` protocol field).
- Macro / Sub-note tabs now carry hover explainers.

## Recommended to the owner (not applied — naming is identity)

- **"Sub-note" → "Instrument designer"**: more inviting to non-research
  users; costs the connection to the sub-note/macro engine split that
  the patch-half loading (Q1) makes user-visible. If renamed, rename the
  MACRO|SUB-NOTE half-segments on palette cards together.
- **"Macro" → "Behaviour"**: same trade-off, same coupling.
- Decide both at once or not at all; the halves and the tabs must share
  vocabulary.
