# SG2 Techniques Exchange (owner-mandated, 2026-07-16)

Cross-agent knowledge transfer without the owner as router. Any agent that
discovers a GENERALISABLE technique — anything affecting parameters,
validation criteria, fitting method, or engine laws that plausibly applies
beyond the instrument it was found on — writes an entry here. Every agent
reads new entries AT THE START OF EVERY PASS and either incorporates,
adapts, or records inline feedback. Escalate to the owner only on
unresolved disagreement.

## Protocol

- **Append-only entries**, `T-NNN`, template below. Never rewrite another
  agent's entry body; add to its `Status` block.
- **FAMILY FIREWALL still governs**: entries carry MECHANISMS and methods;
  fitted VALUES never transfer. Every entry states its firewall level
  (within-instrument / across-instrument / method-only).
- This file does not replace data contracts for code interfaces — those
  stay in PR descriptions with consuming-side assertions.
- Each entry's `Status` lists every lane (engine / analysis / future
  campaign agents) as: `incorporated <commit>`, `adapted <how>`,
  `rejected <reason>`, or `pending`. An entry pending for a lane across
  two of that lane's passes must be flagged in that agent's next summary.

## Template

    ### T-NNN · <title>
    Author: <lane> · Date · Firewall level: <level>
    Finding: <what generalises, with evidence pointer (L-note, annex claim, commit)>
    Affects: <parameters / validation criteria / method>
    Status: engine=<...> analysis=<...>

---

### T-001 · Excitation noise floor: airflow × inefficiency, body-routed, textured
Author: owner/plan (L4) · 2026-07-16 · Firewall: mechanism (all families)
Finding: sustained excitation noise (breath, bow-hair friction, sung
breathiness) = one architecture: noise source → same body response as
partials → gain follows amplitude envelope (airflow proxy) × inefficiency
ratio law (ratio ↑ at soft dynamics) + seeded turbulence texture. Never a
per-note random gate.
Affects: breath* params generalising to bow scratch; L1/L4 laws.
Status: engine=incorporated (blown, reeds; brass + bow pending) analysis=incorporated (noise features) bowed=adapted 8e3bc5b (bow-scratch senses landed; bow engine defaults via T-024) struck/plucked=adapted (body-routed contact/onset noise only; sustained floor remains neutral pending family evidence)

### T-002 · Articulation strength: one latent per-note draw, anticorrelated outputs
Author: owner (L5b) · 2026-07-16 · Firewall: mechanism (all families)
Finding: plosive/scratch transient level, onset pitch deviation, and noise
lead derive from ONE seeded articulation-strength draw (strong = clean
pitch + loud transient; weak = noise lead + pitch settle). Independent
draws produce impossible combinations. Coupling fitted per family from
onset-energy vs pitch-deviation correlation in references (≥4 onsets,
r ≤ −0.2 gate).
Affects: articulationCoupling/Variation, onsetScoop*/wander params, onset
assertions.
Status: engine=incorporated (blown) analysis=incorporated (onset observables) bowed=incorporated 43c230a (wanderCents both-direction sense; firewall gate blocks unevidenced couplings) struck/plucked=adapted (audit transient-energy/hardness coupling; pitch-deviation output stays neutral unless family corpus supports it)

### T-003 · Body application granularity at low register
Author: owner (L12) · 2026-07-16 · Firewall: mechanism (all bodied instruments)
Finding: narrow fitted body bands applied at low register land on
individually-resolved partials and spotlight one into a dissonant
quasi-note. Bands need a width floor tied to partial spacing, or
envelope-mode application below a crossover, or neighbour-relative gain
caps. Applies to every instrument whose playing range reaches sparse
partial spacing (cello, bass voice, guitar low strings, horn pedal).
Affects: resonances emission (analysis) + bodyResponse application (engine).
Status: engine=pending (needs analysis spec: selected law, parameter, bounds, and headless consumer assertion) analysis=adapted 8e3bc5b/6f4c027 (fit-side width floor TRIED AND REVERTED — smeared narrow A0/B1; option (c) selected, exact law+bounds+assertion in T-025; lowestF0Hz emitted) bowed=same struck/plucked=adapted (low guitar and harp references get a body-band granularity watch gate; engine law/value pending corpus evidence)

### T-004 · Measured-body calibration: unity at default
Author: integrator · 2026-07-16 · Firewall: method
Finding: deconvolution divides the FULL body from tables; render must
restore the full measured body at default settings (violin +7 dB bridge
hill rendered as +2.4 dB under amount 0.35). Convention: fitted
`resonances` reproduce the measurement at the default amount; the knob
means more/less than real. Headless assertion: measured instrument at
defaults reproduces fitted body envelope within tolerance.
Affects: resonances gains (analysis) / bodyResponse consumption (engine) /
spectralResonanceAmount semantics.
Status: engine=pending (needs analysis spec: exact default calibration convention/tolerance and emitted provenance field) analysis=incorporated b68d67f (convention+tolerance+fields stated in T-025; reconstructionAmount/roundTripShapeMaxDb emitted per their T-018) struck/plucked=incorporated (require default measured-body reconstruction plus consuming-side assertion before fitted body carries weight)

### T-005 · Coarse band-balance is a first-class scored dimension
Author: research (RESEARCH_SUSTAIN_BALANCE) · 2026-07-16 · Firewall: method + per-instrument targets
Finding: fine mel distance hides octave-scale tilts; sustained-window
band_balance_db (IEC 1/3-oct, band-re-total, per register×dynamic) with
published per-instrument targets (e.g. alto-sax envelope peak ~650 Hz,
break 837 Hz; horn −21/−13/−9 dB/oct at p/f/ff). Also: 95th-percentile
mel normalisation rewards too-bright renders — known scorer bias.
Affects: scorer features, §3 tripwire bars, per-instrument checklists.
Status: engine=incorporated 970be12 (blown scorer + construction consumer + floor-aware hard campaign gate/report) analysis=incorporated 8e3bc5b (band_balance_db 5.a; canonical tripwires.py 5.c; anchors; active bowed, zero-weight blown until objective reset) struck/plucked=incorporated (sustained-window band balance is a scored feature only after the lane controllability audit identifies a responsive free parameter)

### T-006 · Within-instrument vs across-instrument slopes are separate parameters
Author: owner (FAMILY FIREWALL r2, L5c) · 2026-07-16 · Firewall: rule
Finding: the same imperfection can slope opposite ways at the two levels
(scoop: bigger/louder instruments show more; within one instrument, SOFT
onsets show more). Any directional law must name its level.
Affects: every imperfection law and its assertions.
Status: engine=incorporated (scoop) analysis=incorporated (assertions) struck/plucked=incorporated (all dynamic and pair-morph slopes will name within-note versus across-instrument level)

### T-007 · Cross-lane handoffs require consuming-side assertions
Author: owner/integrator · 2026-07-16 · Firewall: process rule
Finding: two owner-audible faults (D4, L6 plumbing) were "fixed" upstream
but unverified at the consumer. Data delivered ≠ done: every contract
lands with an assertion that the consumer provably uses it.
Affects: all data contracts (profiles, resonances, humanRanges, targets).
Status: engine=incorporated d5a33ef/970be12 (measured-body and T-005 consuming-side assertions) analysis=incorporated 6f4c027/b68d67f (T-011/T-012/T-020 consuming assertions; iterate exclusion check; round-trip test) struck/plucked=incorporated (every profile, gate, humanRanges, and engine-spec handoff will carry a consuming-side assertion)

### T-008 · Blown-shaped DEFAULTS are not neutral for other excitations
Author: owner (L11) · 2026-07-16 · Firewall: rule extension
Finding: the firewall covered fitted values but not defaults — bow renders
inherited blown-shaped onset defaults (scoop-from-below + breathy noise)
and read as brass. Per-excitation defaults need the same discipline as
fitted values: a new excitation type gets NEUTRAL imperfection defaults
until its family's evidence fits them.
Affects: excitation-type default tables for every imperfection law.
Status: engine=incorporated b04379a (scoop-from-below fallback is blow-only; non-blown defaults are exact-neutral with headless assertion) analysis=n/a struck/plucked=incorporated (all non-struck imperfection defaults remain neutral; struck/plucked values require dossier plus family-corpus fits)

### T-009 · One canonical LTAS/tripwire implementation across families
Author: engine/blown lane · 2026-07-16 · Firewall: method-only
Finding: simultaneous T-005 implementations were detected before merge.
The common architecture is: one sustained 1/3-octave profile extractor in
`score.py`; one excitation-generic §3 evaluator (including published
envelope anchors) in `tripwires.py`; `iterate.py` is the sole campaign
consumer and adds duplicate-take floor widening, hard optimizer gating,
resource/controllability/leaderboard reporting, and `listen-*` artifacts.
Short-note/missing evidence is listed as not-applicable for one-pair tools
but FAILS a strict campaign. Bowed-only rolloff/lock-in senses remain
neutral/zero-weight for blown; band balance is active after the blown
objective-ID reset. Evidence: engine commit 970be12 and analysis worktree
pending `tripwires.py`; divergence here would violate the owner-mandated
single architecture.
Affects: score.FeatureBundle / tripwires API / iterate consumer / run reports.
Status: engine=adapted (970be12 consumer landed; will replace inline evaluator with canonical tripwires.py after analysis commit) analysis=incorporated 8e3bc5b/b68d67f (canonical tripwires.py + per-bar-cell aggregation landed on agentb/analysis-lane; iterate wiring is the agreed next consumer step) struck/plucked=adapted (consume the canonical API after merge; percussive notes require decay-aligned rather than sustained LTAS windows)

### T-010 · Low-body and unity contracts must be emitted to the JS consumer
Author: engine/blown lane · 2026-07-16 · Firewall: method-only
Finding: analysis work in progress selects T-003 option (c) and records
`resonancesFit.lowestF0Hz`, but the generated `measured_profiles.js` currently
omits the entire `resonancesFit` sibling. The engine therefore cannot prove it
consumes the crossover evidence. Before the single-writer engine change lands,
analysis must emit that sibling (or a named engine metadata subset) and state
the exact neighbour-relative cap law, units, constants/bounds, and tolerance.
T-004 likewise still needs the exact default calibration convention,
reconstruction tolerance, and provenance field. Per T-007, the engine will
land both laws with headless assertions that fail if either metadata field is
absent or unused; merely present JSON is not acceptance.
Affects: generated measured-profile schema / bodyResponse application /
spectralResonanceAmount default / headless consumer assertions.
Status: engine=pending (consumer boundary reviewed; awaiting the exact emitted contracts) analysis=incorporated b68d67f (resonancesFit subset incl. peakHzA/B + omittedReason in measured_profiles.js; exact laws in T-025) struck/plucked=adapted (grand/nylon seeds consume unity bodies now, but fitting stays blocked until emitted round-trip and low-F0 contracts pass T-007 assertions)

### T-011 · Dynamic articulation acts on the shared onset latent
Author: engine/blown lane · 2026-07-16 · Firewall: mechanism (all sustained families; values per instrument)
Finding: owner L9 is implemented as neutral `articulationVelocitySlope` in
[-1.5, 1.5]. The law is
`strengthMean = clamp(baseStrength + slope * (velocity - 0.62), 0, 1)`;
the existing one seeded Human-scaled draw then produces plosive gain,
breath-lead gain, and scoop together. Positive values make forte more firmly
articulated without creating a second transient control; zero is an exact
identity. Headless assertions prove the positive slope strengthens the forte
plosive while reducing breath lead/scoop and prove zero removes the dynamic
bias. Analysis consuming assertion required for trumpet: the fitted value is
positive and the rendered loud-minus-soft onset-transient direction matches
its own reference pairs.
Affects: articulationVelocitySlope / onset construction assertions / L9.
Status: engine=incorporated 5735720 analysis=incorporated 6f4c027 (trumpet.dynamic-articulation: slope > 0 AND rendered loud-minus-soft onset direction matches this instrument's references) struck/plucked=rejected (hammer/pluck dynamics use G7 velocity-to-hardness; blown articulation-latent values do not transfer without struck/plucked corpus evidence)

### T-012 · Owner-rejected reference files are hard-excluded before objective IDs
Author: engine/blown lane · 2026-07-16 · Firewall: process rule
Finding: the current frozen trumpet manifest still includes owner-rejected
`trumpet_C5_15_fortissimo_normal.mp3` as `phil-high-ff-72.wav`, despite binding
note L3. It must be absent from spectral fitting, tripwire rows, duplicate
floors, controllability inputs, and the reference-set/objective hash. The
owner-approved `saxophone_C4_15_fortissimo_normal.mp3` remains eligible, so
this is a per-take exclusion, not a source-wide Philharmonia rule. The
campaign builder needs a named exclusion registry plus a consuming assertion
that no excluded sourceFile can enter `references.json`; COVERAGE records the
reason. The trumpet P5.2 baseline must reset again after removal.
Affects: build_campaign reference selection / QC / objective IDs / trumpet leaderboard.
Status: engine=adapted (pre-refit audit blocks the invalid trumpet manifest) analysis=incorporated 6f4c027 (exclusions.py registry enforced in build_campaign, strings_prep, iterate; consuming test) struck/plucked=incorporated (reference exclusions precede manifest/objective hashing; no family-wide source ban)

### T-013 · Strict gate evidence is required per register×dynamic cell
Author: engine/blown lane · 2026-07-16 · Firewall: method-only
Finding: several valid optional Philharmonia duplicates are shorter than the
T-005 sustained-window minimum, while the same register×dynamic cells have
long Iowa evidence. `970be12` currently fails strict mode for each short take;
the in-progress canonical evaluator leaves every N/A non-failing. Both are
wrong at campaign level. Aggregate tripwire evidence by
instrument/register/dynamic: an individual short take stays visibly N/A, a
cell passes a bar when at least one eligible take measures and all measured
takes clear their floor-aware limit, and a strict campaign fails when a
required cell has no measured evidence. Consuming assertion: one short plus
one valid duplicate passes/retains the N/A row; two short duplicates fail the
strict cell. This preserves §3 coverage without discarding useful short onset
references.
Affects: canonical tripwires.py API / iterate strict consumer / run-report table.
Status: engine=pending (970be12 consumer must be adapted after canonical merge) analysis=incorporated 6f4c027, per-bar strictness corrected per T-017 in b68d67f struck/plucked=incorporated (strict evidence required per tripwire×register×dynamic, with short-note bars visibly N/A)

### T-014 · Body deconvolution mask must equal the emitted reconstruction mask
Author: engine/blown lane · 2026-07-16 · Firewall: method-only
Finding: analysis v3 work in progress correctly prunes unsupported or
split-half-unstable body bands from emitted `resonances`, but currently divides
the partial tables by the full unpruned coefficient vector. The renderer can
never restore omitted coefficients, leaving permanent spectral holes in the
fitted excitation. Apply the final emission mask before deconvolution (or
reconstruct the deconvolution envelope from the emitted band rows exactly).
Contract fields should record `reconstructionAmount: 1` and the achieved
round-trip tolerance. Analysis assertion: raw partial amplitude versus
`emittedBody(amount=1) * emittedResidual` agrees within the declared tolerance
for every fitted point. Engine assertion then applies those same rows at the
declared amount and verifies the same envelope. This closes T-004/T-007 on
both sides rather than merely changing the knob default.
Affects: fit_fixed_body residual tables / resonancesFit provenance / T-004 engine consumption.
Status: engine=pending (live-contract review; no incompatible engine law landed) analysis=incorporated 6f4c027 (mask equality) + b68d67f (roundTripShapeMaxDb per their T-018) struck/plucked=incorporated (piano/guitar/harp bodies may not carry weight until the emitted reconstruction mask round-trips within tolerance)

### T-015 · Open cylindrical bore is an explicit construction class
Author: engine/blown lane · 2026-07-16 · Firewall: mechanism
Finding: flute was added to WP-5 after the dossier's original assertion pass,
and the campaign currently labels it `resonatorClass: string`. The numerical
ratio law is right but the construction assertion is false. Engine commit
`ee1f090` adds neutral `openTube` with `ratio(n)=n`, identical in sound to the
former alias, exposes it in Advanced UI, and headlessly asserts the full
series. Analysis contract: `RESONATOR[flute] = openTube`, expected-resonator
assertion equals `openTube`, manifest categorical values include it, and a
consumer test proves a built flute seed carries it. Dossier checklist v3 also
requires `flute.air-jet-breath-law` (non-zero fitted `toneBreath` and
`breathTurbulence`) plus `flute.body-stability`: non-minimal body bands require
the emitted split-half stability field to clear the analysis-selected bound;
otherwise the air-jet body prior is minimal. These assertions close L7 at the
consumer rather than merely adding a flute row to the corpus.
Affects: resonatorClass enum / flute campaign builder / construction assertions / L7.
Status: engine=incorporated ee1f090 analysis=incorporated b68d67f (RESONATOR/assertion/manifest = openTube; air-jet-breath-law + body-stability assertions; consumer test) struck/plucked=n/a (open cylindrical bore is outside this family)

### T-016 · Air-jet body prior has an explicit stability gate
Author: engine/blown lane · 2026-07-16 · Firewall: within-instrument (flute)
Finding: make T-015's flute body assertion exact. A non-minimal fitted flute
body is eligible only when `resonancesFit.splitHalfCorr >= 0.80` AND the two
split-half peak locations agree within one third octave:
`abs(log2(peakHzA / peakHzB)) <= 1/3`. Otherwise analysis emits no flute
resonance bands and records `resonancesFit.omittedReason:
"unstable-air-jet-body"`; the flute measured-body assertion accepts that
explicit evidence-backed omission instead of requiring three bands. This is a
method gate, not a transferred fitted value: it prevents a steep air-jet
spectrum from being re-minted as a kazoo-like fixed formant (L7). Consuming
tests cover one stable/non-minimal profile and both failure conditions.
Affects: flute resonance emission / measured-body construction assertion / L7.
Status: engine=pending (will consume the emitted decision, not re-evaluate hidden JSON) analysis=incorporated b68d67f (stability gate in fit_fixed_body; omittedReason emitted; tables undivided on omission per T-014) struck/plucked=n/a (flute-only prior)

### T-017 · Strict coverage is per bar×register×dynamic, not any-bar per cell
Author: engine/blown lane · 2026-07-16 · Firewall: method-only
Finding: the live T-013 aggregator currently marks a required cell evidenced
when ANY tripwire bar measured there. That lets an onset/partial measurement
hide a missing sustained band-balance measurement. Strict campaign coverage
must reject every `no-evidence` row whose `(bar, register, dynamic)` is
required (with only explicitly family-inapplicable bars, such as blown B,
excluded from required bars). The assertion with two short duplicates must
check the band-balance row specifically; one short + one long duplicate keeps
the take-level N/A but passes that bar/cell. `strictMissingCells` should carry
the bar name so the run report names the missing evidence.
Affects: tripwires.aggregate_by_cell / strict campaign consumer / §3 report.
Status: engine=pending analysis=incorporated b68d67f (aggregate_by_cell strict per bar-cell; strictMissingCells names the bar; family-inapplicable bars excluded; consuming test) struck/plucked=incorporated (required bars will be declared per instrument; no any-bar evidence shortcut)

### T-019 · Carried v2 blown bodies do not satisfy the v3 engine contract
Author: engine/blown lane · 2026-07-16 · Firewall: process/data contract
Finding: the live generated JS now exposes v3 metadata for violin/cello, but
flute, clarinet, alto-sax, trumpet, and French horn were carried through
`--keep-existing` as `ensemble-rank-note-body-v2`. They lack `lowestF0Hz`,
`reconstructionAmount`, real round-trip shape error, and split peak fields;
T-003/T-004/T-016 cannot consume them. Regenerate all five blown measured
profiles through the final v3 fitter after T-014/T-018, with no carried v2
body/residual pair. JS provenance must include `peakHzA`, `peakHzB`, and
`omittedReason` in addition to the T-010 fields so the flute decision is
provable. Consuming assertion: every measured blown profile has method v3 and
all mandatory fields before a campaign builder may emit its initial preset.
Affects: blown measured_profiles JSON/JS / build_campaign / consolidated refit wave.
Status: engine=pending (refit wave blocked on the actual v3 blown rows) analysis=in-progress b68d67f (full v3 regeneration of the five blown + violin/cello running; new struck/plucked corpus folders lack contracts and are excluded from this run) struck/plucked=n/a (blown-profile migration; the same v3 schema will be required when struck/plucked profiles regenerate)

### T-018 · Round-trip provenance measures the exported reconstruction
Author: engine/blown lane · 2026-07-16 · Firewall: method-only
Finding: the live T-014 response names `roundTripMaxDb` but currently records
only body safety-clamp error, while its exported-band reconstruction test
allows `ptp(log ratio) < 0.25` (about 2.17 dB). The provenance field must be
the maximum scale-free SHAPE error after the actual emitted freq/gain/width
rounding: per note, reconstruct `emittedResidual * emittedBody(amount=1)`,
remove the median dB offset, then take max absolute dB error over fitted
points. Acceptance is `roundTripShapeMaxDb <= 1.0`; emit that achieved value
to JS. The engine consuming assertion uses the rounded JS rows and the same
1 dB bound. Clamp diagnostics may remain separately named
`bodyClampMaxDb`; they cannot stand in for reconstruction accuracy.
Affects: resonancesFit provenance / analysis round-trip assertion / T-004 engine assertion.
Status: engine=pending analysis=incorporated b68d67f (roundTripShapeMaxDb from ROUNDED emitted rows, median offset removed, acceptance <= 1 dB; bodyClampMaxDb separate) struck/plucked=incorporated (require exported rounded-body shape error <=1 dB before piano/guitar body loss is enabled)

### T-020 · Percussive f0 analysis consumes the known note anchor
Author: struck/plucked lane · 2026-07-16 · Firewall: method-only
Finding: the current monophonic tracker locks to strong upper modes on low
piano/guitar and returns no stable pitch on short high notes (grand preflight:
89/132 render contexts failed or jumped modes). Reference filename/score MIDI
is known before analysis. Add optional `expectedF0Hz`; select the candidate
whose harmonic-family likelihood is maximal within ±50 cents of that anchor,
while retaining the unconstrained estimate as QC provenance. Never silently
rewrite source MIDI. Consuming assertion: synthetic stiff-string C1 with a
dominant third mode and C8 with <4 resolved partials both return the anchored
fundamental; an anchor >50 cents from every candidate fails loudly. Until this
lands, all affected controllability features are zero-weight watch metrics and
the campaign status is `blocked-analysis`.
Affects: analyse_note/analysis.py feature extraction / controllability / B and bar-mode gates.
Status: engine=n/a analysis=incorporated b68d67f (expectedF0Hz anchor: harmonic-family candidate within 50 cents, loud failure otherwise, f0_unconstrained provenance; plumbed through analysis.py + score.extract_features; consuming tests) struck/plucked=incorporated (campaign and measured-profile generation trust declared single-note pitch; regenerated nylon anchors are 82.407/195.998/659.255 Hz; profile-v2 pass improved raw error 19.82% and active failures 16→14)

### T-021 · Coupled-polarisation beating is an opt-in two-mode law
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; values per instrument
Finding: piano unisons and orthogonal string polarisations need a second close
mode, but the present one-oscillator-per-partial renderer cannot generate the
beat-rate watch metric. Engine spec: `polarisationAmount` [0,1], neutral 0;
`polarisationSplitCents` [0,6], inert at amount 0; and
`polarisationDecayRatio` [0.25,4], default 1. For partial amplitude A, let
`w=0.5*amount`, gains `A*sqrt(1-w)` and `A*sqrt(w)` (energy preserved), second
frequency `f*2^(splitCents/1200)`, and second T60 `T60*decayRatio`. Headless
assertions: amount 0 preserves the golden PCM hash; enabled energy stays
within 0.25 dB; measured envelope-modulation peak equals the predicted
frequency difference within 5%; decay ratio changes late/early beat energy
without moving either modal frequency. Scorer beat rate/depth stays weight 0
until this parameter demonstrably moves it.
Affects: spectral partial renderer / DEFAULTS+manifest / temporal-beating scorer.
Status: engine=incorporated 3c7ddf9 (neutral defaults/UI, energy-preserving two-mode renderer, shared automation/body path, independent T60, pure beat/decay assertions, and enabled headless WebAudio consumer check) analysis=adapted (watch metric filed, zero weight) struck/plucked=incorporated (grand and nylon audits list the gap)
Status update (annex C2/C22/N3): superseded by T-026; cents-split oscillators are not the requested bounded amplitude-domain contract.

### T-022 · Bar-mode spread is controllable without faking string B
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; provisional until struck annex/corpus
Finding: `bar` currently exposes one fixed ratio table, so glock mode tuning is
uncontrollable and must never be fitted via string `B`. Engine spec:
`barModeSpread` [0.75,1.25], neutral 1; for fixed table ratio `r_n`, use
`r'_1=1`, `r'_n=1 + barModeSpread*(r_n-1)` for n>1. It applies only to the
bar class and leaves measured per-mode tables as the future higher-resolution
contract. Headless assertions: spread 1 reproduces every existing ratio and
golden fixture; ratios remain positive/ordered over bounds; raising spread
moves every n>1 away from the fundamental and leaves string/membrane classes
bit-identical. Do not land a fitted default until RESEARCH_STRUCK_PLUCKED and
glock references confirm this one-dimensional law.
Affects: resonatorRatio / DEFAULTS+manifest / glock mode-ratio scorer.
Status: engine=pending (await annex/corpus verdict before implementation) analysis=adapted (bar tuning declared zero-weight watch metric) struck/plucked=incorporated
Status update (annex C28-C32/N5): superseded by T-027; one spread scalar cannot represent measured per-mode thick-bar trims.

### T-023 · Release damping is independent of held-note material decay
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; values per instrument
Finding: current release ring is derived from material only, so piano damper,
harp hand damping and free glock ring are not independently controllable.
Engine spec: `releaseDamping` [0,1], neutral 0; on note-off use
`effectiveRing = baseReleaseRing * exp(-4*releaseDamping)` without changing
the held-note T60/G4 two-stage law. Headless assertions: zero preserves the
golden PCM hash; damping 1 lowers energy 0.5 s after note-off by >=12 dB;
pre-note-off spectrum/envelope differs by <0.01 dB; the law is monotone across
the bounds. Release/damper distance remains weight 0 until this control and a
note-off-aligned scorer feature both land.
Affects: note-off partial release / DEFAULTS+manifest / release-ring scorer.
Status: engine=incorporated 06f7455 (neutral default, exp(-4d) note-off law, UI and headless assertions) analysis=adapted (watch metric filed, zero weight) struck/plucked=incorporated
Status update (annex C31): landed note-off damping does not model glock mounting; glock still needs per-mode held-decay control under N5.

### T-024 · Controllability reports are hashed consuming contracts
Author: struck/plucked lane · 2026-07-16 · Firewall: method-only
Finding: a clean audit is valid only for the exact reference objective and
free-parameter manifest it perturbed. Reports carry canonical hashes of both,
per-feature responsive parameters, final weights, and zero-weight watches.
The fitter consuming assertion rejects instrument/hash mismatch, non-clean
status, or any positive-weight feature with no responder. Conditional neutral
laws declare an `auditContext` (e.g. enable G4 ratio while perturbing amount)
that is audit-only, never a fitted default.
Affects: controllability.py / iterate.py / objective IDs / run reports.
Status: engine=n/a analysis=adapted (canonical implementation may absorb this contract) struck/plucked=incorporated (branch implementation + tests)

### T-025 · G7 requires an audio-side brightness assertion
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; existing parameter
Finding: the existing `velocityHardnessCoupling` [0,1] and law
`h'=clamp(h + coupling*(velocity-0.62)*0.75,0,1)` pass only a scalar-law test.
The nylon audit found no response in partial-table, log-mel, centroid or onset
tilt at a 10%-of-range perturbation; only the B estimator moved, which is not a
valid G7 consequence. Add a consuming headless assertion through
`excitationSpectrum`: for strike and pluck at fixed base params, coupling 1
must raise the upper(n>=8)-to-lower(n<=4) partial-energy ratio from velocity
0.2 to 1.0 by >=3 dB; coupling 0 must leave the hardness-derived ratio equal
within 1e-12 before the separate dynamic-brightness law. If the current law
cannot clear it, fix the hardness consumption, not the scorer threshold.
`velocity_hardness_brightness` stays a zero-weight watch metric until the
render-level controllability audit crosses its threshold.
Affects: velocityHardness consumer / excitationSpectrum / verify_tone_model G7 / nylon and piano construction gates.
Status: engine=incorporated c4712c9 (actual `excitationSpectrum` consuming assertion: coupling 0 is neutral to 1e-12 and coupling 1 moves the n>=8/n<=4 energy ratio by >=3 dB for both strike and pluck) analysis=adapted (targeted control-effect audit filed) struck/plucked=incorporated

### T-025 · L9 slope must be optimizer-controllable before its gate is active
Author: engine/blown lane · 2026-07-16 · Firewall: process/parameter contract
Finding: the live analysis response adds `trumpet.dynamic-articulation`, but
`articulationVelocitySlope` is not yet in `tone_match/manifest.json`; the
campaign can fail the gate but cannot adjust the responsible law. Add the
continuous blown parameter with engine bounds `[-1.5, 1.5]`, step `0.01`,
neutral default `0`, include it in the trumpet consolidated free set, and
include it in the controllability matrix. Consumer assertion: `_params`
resolves it for `excitationType=blow` and a perturbation changes the onset
transient observable; only then may the L9 construction row be hard-gated.
Affects: optimizer manifest / trumpet campaign / controllability / L9.
Status: engine=incorporated 5735720 analysis=pending struck/plucked=n/a

### T-026 · Polarisation/unison beating is bounded amplitude-domain modulation
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; supersedes T-021 after annex C2/C22/N3
Finding: engine spec: `partialBeatDepth` [0,0.95], neutral 0, and
`partialBeatRateHz` [0.1,3], fitted/seeded per note from `humanRanges`; G4
continues to own early/late energy. For each partial, seeded phase phi and
`gain(t)=baseGain(t)*(1+d*sin(2*pi*rate*t+phi))/sqrt(1+d^2/2)` preserve
cycle RMS while remaining non-negative. No oscillator frequency moves: this
is not vibrato. Headless assertions: depth 0 preserves golden PCM; modulation
spectrum peaks at rate within 5%; cycle RMS stays within 0.25 dB; instantaneous
gain remains non-negative; changing rate/depth leaves partial frequencies and
G4 T60 plan unchanged. Beat rate/depth scorer remains zero-weight until the
render audit demonstrates this consumer.
Affects: per-partial gain automation / DEFAULTS+manifest / beat-rate scorer / humanRanges.
Status: engine=pending analysis=adapted (annex-aligned watch metric) struck/plucked=incorporated

### T-027 · Bar tuning consumes per-mode ratio trims, never string B
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; supersedes T-022 after annex C28-C32/N5
Finding: engine spec: structured `barModeRatioOffsetsCents` with mode 1 fixed
at 0 and modes 2-6 each in [-386,0] cents (up to the annex's 20% downward
Timoshenko correction), neutral all-zero. For base free-bar ratio r_n,
`r'_n=r_n*2^(offset_n/1200)`. Measured per-preset tables may narrow these
bounds; marimba/xylophone/vibraphone supply their own target tables. Headless
assertions: absent/all-zero offsets reproduce current table and golden PCM;
offsets cannot affect non-bar classes; output ratios remain positive/ordered;
string B is ignored/forbidden for bar; a -386-cent mode-3 trim lowers that
ratio by 20% within tolerance. The glock gate scores modes 2-3 within ±35
cents of its fitted table. N5b/N5c remain separate: per-mode T60 and bar-mode
strike-position weights.
Affects: resonatorRatio/bar profile schema / DEFAULTS+manifest / glock ratios and interim bar presets.
Status: engine=pending analysis=adapted (bar ratios zero-weight until consumer lands) struck/plucked=incorporated

### T-028 · Hardness is a register- and velocity-scaled contact-time low-pass
Author: struck/plucked lane · 2026-07-16 · Firewall: mechanism; annex C9-C11/C32/N1-N2
Finding: replace/augment the generic hardness rolloff with structured
`contactTimeByRegister` anchors in [0.2,8] ms (absent = exact-neutral legacy)
and reuse `velocityHardnessCoupling` c in [0,1]. Interpolate base tau in
log-f0; scale `tau_eff=tau_base*clamp(1-0.25*c*(velocity-0.62)/0.38,0.5,1.5)`
(about +28% pp, -25% ff at c=1), then apply the fitted sinc-like contact
low-pass to the strike/pluck/mallet excitation spectrum before body response.
Piano corpus should fit roughly 4 ms bass to <1 ms treble; values do not
transfer to guitar/glock. Headless assertions: absent anchors/c=0 preserve
legacy golden output; exact anchor interpolation; c=1 raises the contact
corner by 20-30% pp->ff and the n>=8:n<=4 energy ratio by >=3 dB; 4 ms is
darker than 1 ms at equal f0; bow/blow are bit-identical. Scorer adds
onset-corner velocity slope only after this control crosses audit threshold.
Affects: excitationSpectrum/hardness consumer / register profile schema / G7 assertions.
Status: engine=pending analysis=adapted (T-025 audio assertion retained) struck/plucked=adapted (profile-v2 pass preserves dynamic-brightening slope 0.415 at the fitted static tilt; T-028 remains required to fit velocity/contact colour independently of the shared spectrum)

### T-029 · ENGINE SPEC (URGENT): body gain must track instantaneous frequency under FM
Author: bowed lane · 2026-07-16 · Firewall: mechanism (all bodied instruments)
Finding: the violin controllability audit CONFIRMED annex N1 empirically —
`body_am_db` response is 0.0 to every free parameter including vibrato
depth/rate through a 10-band fitted body: the body EQ is evaluated once
per note, so vibrato FM produces zero per-partial AM. Per C28/C29 (Gough,
M&W 2000, F&S 1967: 3–15 dB per-partial AM, sometimes >25 dB; AM outweighs
FM perceptually) this is rank-2 for string realism and gates the bowed
campaign's vibrato quality wholesale.
Spec: per audio block (>= 100 Hz update), each partial's body gain is
re-evaluated from the interpolated bodyBands curve at the partial's
INSTANTANEOUS frequency (vibrato + wander included). No new parameter;
exact-neutral for static-frequency notes by construction. Headless
assertion: violin render, 18-cent vibrato, fitted body => scorer
`body_am_db` >= 3 dB median over tracked partials 2–10 (assertions.py
`violin.vibrato-body-am` is the consuming gate, currently unpassable).
`body_am_db` flips from watch metric to weighted on landing + audit re-run.
Affects: _renderSpectralPartials body application / T5 path.
Status: engine=pending analysis=incorporated 6f4c027 (sense, gate, watch-metric plumbing all waiting on this) struck/plucked=n/a (no sustained vibrato-FM target in this family)

### T-030 · ENGINE SPEC: vibrato trajectory controls (delay, ramp, rate drift)
Author: bowed lane · 2026-07-16 · Firewall: mechanism; values per instrument
Finding: audit confirms no engine parameter moves vibrato onset delay,
depth ramp-in, or rate drift (annex N4; SWAM exposes Vibrato Fade In and
Rate Rand). A locked-LFO vibrato is the "mechanical" tell the preflight
warned about.
Spec: three DEFAULTS keys, all exact-neutral at 0: `vibratoOnsetDelayMs`
[0, 1500] default 0; `vibratoRampMs` [0, 1200] default 0;
`vibratoRateDrift` [0, 0.5] Hz/s default 0 (seeded slow wander of the
rate around vibratoRate, Human-scaled). Depth envelope: 0 until delay,
then ramp to full depth over rampMs. Headless assertions: delay=400 on a
3 s render => scorer `vibrato_onset_delay_ms` in [280, 520]; all three
at 0 => vibrato path bit-identical to today.
Affects: vibrato render path / DEFAULTS+PARAM_DESC / manifest free tier.
Status: engine=pending analysis=incorporated 8e3bc5b (senses + watch metrics + audit ready to re-verify) struck/plucked=n/a (bowed vibrato trajectory only)

### T-031 · ENGINE SPEC: bow onset = period-scaled scratch + wander/settle (never scoop)
Author: bowed lane · 2026-07-16 · Firewall: mechanism; ALL values fitted from string corpus (T-008)
Finding: owner L11 — bow baselines read as brass because onset machinery
carried blown-shaped defaults. G&A 1997 / Guettler (annex C18–C21): bow
onsets are period-scaled aperiodic scratch resolving into Helmholtz
within <= 18 nominal periods (good <= 10), with pitch WANDER/SETTLE
(prolonged-period starts sit flat/below; multiple-slip starts flicker
sharp) — never the blown scoop-from-below pressure gesture.
Spec:
1. `onsetWanderCents` [0, 120] default 0 + `onsetWanderSettlePeriods`
   [2, 30] default 12: seeded per-note onset f0 deviation with BOTH
   signs, drawn from the articulation-strength latent (strong => little
   wander; weak/soft => more; sign per C20/C21), settling over
   period-scaled time (cello C2 legitimately takes ~15x violin A4's ms).
   Human 0 => exact pitch.
2. Bow scratch: reuse the T-001 noise architecture with per-excitation
   bow defaults — broadband (violin measured ~1 kHz centroid, Q ~0.84),
   duration period-scaled, colour sign flipping with articulation
   strength (accented => low-centroid crackle; soft => high-centroid
   surface whistle).
3. Every blown onset default (scoop tables, breath colour) exact-neutral
   for excitationType bow (T-008 discipline, extended to all laws).
Headless assertions: bow render at Human 0 => onset f0 deviation < 3
cents; Human 1 wander draw produces both signs across 16 seeded notes;
scratch centroid sign flips between articulationStrength 0.2 and 0.9;
blow renders bit-identical.
Affects: onset f0 path (excitation-generic) / attackNoise per-excitation
defaults / articulation latent coupling.
Status: engine=pending analysis=incorporated 8e3bc5b (onset_wander_cents, onset_lockin_periods, onset_noise_centroid_oct senses + firewall assertion are the measuring side) struck/plucked=n/a (bow lock-in law; struck contact transients use annex N2)

### T-032 · Exact laws for the two body contracts (closes T-010's request)
Author: bowed lane · 2026-07-16 · Firewall: method + per-instrument data
Finding: T-010 asked for the exact emitted contracts; they are now
emitted (b68d67f) and defined as:
1. T-004 unity-at-default: emitted `resonances` gains ARE the full
   measured body (log2 units, clipped ±1.5); `reconstructionAmount: 1`;
   `roundTripShapeMaxDb` is the analysis-side reconstruction accuracy
   from the ROUNDED emitted rows (acceptance <= 1.0 dB, per their
   T-018); `bodyClampMaxDb` is the separate safety-clamp diagnostic.
   Consumer law: for measured-body instruments the DEFAULT effective
   spectralResonanceAmount is 1.0 (the knob scales around reality).
   Engine assertion: rendered sustained envelope of a mid note matches
   the fitted band envelope within 1.5 dB at every emitted band centre.
2. T-003 option (c) low-register cap: for a note with fundamental f0 and
   partial n with body gain g_n (log2) and local median m_n over
   {g_{n-1}, g_n, g_{n+1}}: where r = f0 / FWHM_Hz(bands at partial
   freq) exceeds 1 (FWHM_Hz = fc*(2^(1.1775w) − 2^(−1.1775w))), apply
   g_n <- m_n + clamp(g_n − m_n, −CAP, +CAP), CAP = 1.0 log2 (6 dB),
   crossfaded by t = clamp(r − 1, 0, 1). `resonancesFit.lowestF0Hz`
   bounds where this can engage. Engine assertions: cello C2 render —
   no partial 1..12 deviates from its 3-partial median body gain by
   more than 6 dB; violin A4 render bit-identical with the cap enabled.
Affects: bodyResponse consumption / spectralResonanceAmount default /
L12 owner-ear acceptance ("body colour without a resonant extra note").
Status: engine=pending analysis=incorporated b68d67f (all fields emitted and asserted analysis-side) struck/plucked=incorporated (piano/guitar body-weighted fitting remains blocked until these engine consumers land)

### T-033 · ENGINE+ANALYSIS SPEC: per-string identity tables (G1 extension)
Author: bowed lane · 2026-07-16 · Firewall: mechanism; tables per instrument
Finding: the same written pitch on different strings is a different
spectrum (annex C23/C24: violin steel E sustains harmonics to extreme
frequencies, wound G concentrates in ~6; B, damping and flattening
co-vary with string). The corpus provides same-pitch sul-pairs (violin
C6 on sulA and sulE) and reference rows already carry `string`; no
engine table selection exists, so per-string floors cannot be scored
meaningfully yet.
Spec: analysis stores `partialsByString` (per-string register-table sets
keyed sulG/sulD/sulA/sulE; cello sulC/sulG/sulD/sulA) where coverage
allows, pooled-table fallback. Engine: `stringSelect` param (auto =
lowest string covering the note; explicit sul* override) choosing the
table set + per-string B/damping when present. Headless assertion: with
per-string tables present, the same midi under two sul selections
differs in high-band energy in the direction the tables encode; absent
tables => bit-identical fallback.
Guitar consuming extension (Agent C, pass 08): `partialsByString` uses
unambiguous course keys `string6`..`string1` (standard open MIDI
40/45/50/55/59/64). `stringSelect` is the enum
`auto|string6|string5|string4|string3|string2|string1`, default `auto`.
For `auto`, consider courses whose open MIDI is <= the requested MIDI and
whose fret is <= 24, choose the minimum fret, and break ties toward the
lower-pitched course. An explicit course outside that playable interval is
invalid rather than silently falling back. Each course entry may override
the existing bounded `partials`, `partialB`, and material/decay fields; a
missing entry consumes the pooled profile bit-identically. Headless
assertions: (1) E4 auto selects open `string1`; (2) an explicit playable
course consumes its own table; (3) two synthetic course tables with opposite
high-band tilt move rendered n>=8/n<=4 energy by at least 3 dB in the encoded
direction at the same MIDI; (4) absent course tables are bit-identical to the
current pooled renderer; (5) an unplayable explicit course is rejected.
Analysis consuming assertion: a course-labelled reference can contribute
only to its matching course table, and pooled fallback is emitted only when
course coverage is below the declared minimum.
Affects: partialsByRegister schema / engine table selection / WP-6 morph
axis (SWAM exposes Alternate Fingering).
Nylon evidence: pass 05 improved `3.493823→3.475820`, pass 06 improved
`4.080068→4.060831`, and pass 07 improved `4.066990→3.725441`; pass 08 then
tested all seven remaining shared spectrum/onset controls for 44 evaluations
on the repeat-stable objective and produced no improvement
(`3.470322→3.470322`). All six active mel cells remain above bar while
construction is 11/11 and resources pass.
Status: engine=pending (guitar extension above is ready for one-pass consumption) analysis=pending b68d67f (storage lands with the first per-string fit) struck/plucked=blocked-engine T-033 (global-control plateau demonstrated; rerun from durable pass-08 state after consumer lands)

### T-034 · ENGINE SPEC (small): dynamic pitch flattening for bowed forte
Author: bowed lane · 2026-07-16 · Firewall: mechanism; value fitted per instrument; INSTRUMENT physics, not Human
Finding: annex C22 (Schoonderwaldt Paper II): musically loud bowing
flattens pitch 5–10 cents (26–77 near the force limits) via
corner-release hysteresis — a cheap, evidence-backed "bow is pressing"
cue no additive render carries.
Spec: `dynamicFlattenCents` [0, 25] default 0: settled-pitch offset =
−dynamicFlattenCents * max(0, velocity − 0.5) / 0.5. This is
within-instrument dynamic PHYSICS (T-006 level naming): it applies at
Human 0; onset exaggeration rides the T-031 wander draw instead.
Headless assertions: velocity 1.0 render sits dynamicFlattenCents below
velocity 0.5 within ±1 cent; default 0 bit-identical.
Affects: resonator f0 law / DEFAULTS.
Status: engine=pending analysis=pending (pitch-offset sense rides the existing f0 tracker; 7a target row exists) struck/plucked=n/a (bow-force pitch flattening only)

### T-035 · Explicit measured-body omission is data, not permission to fallback
Author: Agent D / analysis custody · 2026-07-16 · Firewall: method-only
Finding: detached verification of `agentb/analysis-lane` at `642eefa`
failed the existing L6 consuming assertion. The v3 flute profile emits
`resonances: []` with `resonancesFit.omittedReason:
"unstable-air-jet-body"`, but the engine retains the hand-authored flute
body. An explicitly emitted empty body with a recognised omission reason
means "use no fitted body"; fallback is allowed only when the profile has
no measured-body decision at all. Headless consumer assertion: explicit
omission yields an empty effective body and differs from the legacy fallback;
profiles with absent `resonances` may still use the logged fallback.
Affects: measured-profile merge / BODY_PRESETS / T-016 / L7.
Status: engine=pending (concrete failure reproduced at `642eefa`)
analysis=incorporated `b359f32` (v3 bulk profile commit quarantined until
the consuming assertion passes) struck/plucked=incorporated (explicit measured-body omission must suppress fallback for every family)

Status update — Agent D takeover (2026-07-16): Agent D has reviewed every
entry T-001…T-035 and accepts custody of all inherited `analysis=` and
`bowed=` dispositions. Incorporated/adapted statuses remain in force.
Pending bowed dependencies are T-003/T-004/T-010/T-014/T-016/T-018/T-019
and T-029…T-035 on their named engine consumers, plus T-033 analysis storage.
T-024's hashed controllability contract and T-009's canonical tripwire
consumer are incorporated on `codex/sg2-agentd-analysis-custody`; the first
new audit/run is required to prove their hashes before fitting proceeds.

### T-036 · Strict gates consume reference roles, not every file indiscriminately
Author: Agent D / analysis · 2026-07-16 · Firewall: method-only
Finding: the violin baseline created six missing vibrato bar/cells and one
missing band-balance cell because floor-only/non-vibrato rows were treated as
full construction evidence. Reference rows need explicit roles:
`spectral`, `onset`, `vibrato`, and `floor`. A row contributes to a bar only
when its role can evidence that bar; floor rows still contribute to
take-to-take variability but never create strict §3 coverage obligations.
Required cells are derived per bar from the campaign's declared coverage
contract, not from the union of every row.
Consuming assertions: two short floor duplicates do not create a
band-balance requirement; a spectral-role row does; a non-vibrato spectral
row does not create a vibrato requirement; a declared required vibrato cell
with no vibrato-role row fails loudly.
Affects: references.json schema / tripwires.aggregate_by_cell / objective hash.
Status: analysis=pending bowed=incorporated (triage and exact tests specified)
engine=n/a struck/plucked=adapted (decay/onset roles replace sustained roles)

### T-037 · Near-zero inharmonicity uses cents, not a B ratio
Author: Agent D / analysis · 2026-07-16 · Firewall: method-only
Finding: violin's fitted register B is zero, yet the baseline's factor gate
reported errors up to 15,000×. A multiplicative ratio is ill-conditioned at
zero and turns estimator noise into the dominant residual. Use the known MIDI
f0 anchor. At the highest reliable resolved mode n, compute stretch cents
`600*log2((1+B*n^2)/(1+B))`. When the reference stretch is below 3 cents,
gate absolute render-reference stretch error <=3 cents; otherwise retain the
factor-1.5 B gate. Insufficient resolved modes are visibly N/A.
Consuming assertions: B=0 versus tiny positive estimator noise passes;
B=0 versus 20-cent upper-mode stretch fails; ordinary non-zero B still uses
the factor gate; the violin baseline no longer names B as dominant merely
because the denominator is zero.
Affects: score.extract_features / tripwires inharmonicity bar / residual ranking.
Status: analysis=incorporated (shared cents-floor scorer + canonical tripwire consumer assertions landed on Agent C branch) bowed=incorporated (baseline evidence) engine=n/a struck/plucked=incorporated

### T-038 · Bow attack calibration separates amplitude rise from lock-in
Author: Agent D / analysis · 2026-07-16 · Firewall: mechanism + method; values per instrument
Finding: violin attack-T90 failed in every required cell, often by
125–291 ms. The current fitted `envelopeAttack` (~0.4 s) follows the slow
global RMS shape of a long bow, while the bowed gate needs the local onset
amplitude rise and pre-Helmholtz lock-in. Analysis must emit two contracts:
`envelopeAttackByRegister` from onset-local 10–90% RMS, and
`onsetLockinPeriodsByRegister` from harmonic stability. Campaign seeds must
pin the former now; T-031 consumes the latter. Never convert the 18-period
literature maximum into a guessed fitted value.
Consuming assertions: a built violin seed carries all measured register
attack anchors; removing them worsens attack_ms; low cello permits more
milliseconds for the same period count; global note fade cannot move either
onset measurement.
Affects: fit_profiles_from_samples / strings_prep seed / T-031 engine contract.
Status: analysis=pending engine=pending (T-031) bowed=incorporated (triaged)

### T-039 · ENGINE SPEC: sustained bow noise uses the shared excitation-noise law
Author: Agent D / bowed · 2026-07-16 · Firewall: mechanism; values per instrument
Finding: `violin.pp-noise-rise` is a hard construction failure. Extend the
T-001 noise consumer to `excitationType=bow`; do not create an unrelated
noise path. The existing continuous controls become excitation-generic
internally while preserving blown compatibility: level [0,0.4], velocity
exponent [0,2] (1 neutral), turbulence [0,1] (0 neutral), body routing
[0,1] (0 neutral), and colour [-1,1] (0 neutral). Bow defaults remain exact
zero until fitted. Noise follows the note envelope, routes through the same
body, and uses seeded texture; the pp/ff ratio sign is fitted from each
string corpus, not transferred from winds.
Headless assertions: all-zero bow settings preserve the golden render;
lowering the exponent raises bow NHR at pp relative to ff without changing
the harmonic core; body routing moves noise-band energy in the fitted body's
direction; blow renders remain bit-identical.
Affects: excitation-noise renderer / DEFAULTS aliases / bowed manifest /
`*.pp-noise-rise`.
Status: engine=pending analysis=incorporated (NHR senses and sign gate)
bowed=blocked-engine

### T-040 · Bowed body generation must evidence the low signature modes
Author: Agent D / analysis · 2026-07-16 · Firewall: method + per-instrument data
Finding: the current v3 violin body round-trips its own emitted rows but
fails the independent dossier fact: it has no positive 250–310 Hz A0 band
and no positive 420–600 Hz B1 band; split-half correlation is 0.451. A
mathematically self-consistent decomposition is not sufficient evidence for
the correct physical body. Profile generation for violin/cello must run the
body-peak-cluster assertions before emission. The fitter may add diagnostic
basis centres around dossier regions, but gains remain corpus-fitted; if the
corpus does not support the modes, generation fails with a named coverage
gap instead of hand-injecting them.
Consuming assertions: synthetic corpus with stable A0/B1 recovers positive
bands in tolerance; split halves disagreeing on a low peak fail emission;
every emitted bowed profile passes its dossier cluster before T-032 engine
consumption is enabled.
Affects: fit_fixed_body / profile generation gate / bowed corpus coverage.
Status: analysis=pending bowed=blocked-analysis engine=pending T-032

### T-041 · Repeat-render stability is part of the controllability contract
Author: Agent C / struck-plucked · 2026-07-16 · Firewall: method-only
Finding: Chromium offline renders with identical parameters may differ by
one 16-bit PCM step. The audio delta is inaudible, but thresholded feature
estimators can amplify it into material loss changes (observed on nylon
guitar inharmonicity and decay). Every distinct audit baseline is therefore
rendered twice more. A feature whose repeat distance crosses the same
mean/peak controllability threshold is zero-weighted as a watch metric before
fitting. Audit schema v3 carries the repeatability matrix plus hashes of the
references, free-parameter manifest, initial preset, scorer contract, and
renderer/profile bytes; older audits are invalid consumers. The optimizer
also caches exact duplicate parameter vectors so Powell cannot score the same
point twice.
Consuming assertions: a pre-v3 audit is rejected; changes to synth.js,
measured_profiles.js, render_note.mjs, or the initial preset invalidate the
audit; a repeat-unstable feature cannot retain positive weight; exact duplicate
candidate vectors return the cached objective without another render; stable
features remain eligible and the objective hash changes when weights or the
renderer contract change.
Affects: controllability.py / iterate.py / objective IDs / every family.
Status: analysis=incorporated struck/plucked=incorporated bowed=adapted engine=n/a
