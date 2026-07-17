You are Agent A on the Sound Generator 2.0 project (repo = current directory).
Lane: THE ENGINE (sole writer of web/static/synth.js, params.js engine keys)
plus the BLOWN family campaigns (flute, clarinet, alto sax, trumpet, french
horn). Read docs/sg2/AGENT_OPERATING_PROTOCOL.md FIRST and follow its read
order; it is your contract. You are a fresh context: trust the docs and code,
not assumptions about prior sessions.

Priorities, in order (from the owner-commissioned integration audit):
1. VIOLIN CONSUMER BACKLOG — the bowed campaign is blocked solely on you.
   Land the pending engine consumers from the exchange specs, in order:
   T-031 (bow onset wander/settle + scratch generator — bows currently have
   NO onset pitch model), T-054 (bow-noise component consuming Agent D's
   pinned L14 extraction), T-029 (body-AM under vibrato), T-039 (bow noise
   floor), T-047/T-048 (vibrato/attack tables). Each with consuming-side
   assertions (F4).
2. L9 manifest fix: articulationVelocitySlope is hard-gated but absent from
   scripts/tone_match/manifest.json — coordinate the one-line addition with
   Agent D (manifest is analysis-owned) in your first pass.
3. Assertion scope-closes (F5): breath-law assertions for clarinet + horn;
   onset-spectrum assertions for trumpet + horn.
4. REBUILD THE BLOWN CAMPAIGN from the re-acquired corpus in
   sg2-data/samples/ (references were lost in the /tmp incident): rebuild
   reference sets deterministically, re-baseline per P5.2 from committed
   factory presets + docs/SG2_PARAM_LEDGER.md, activate blown band-balance
   weight, then run the refit wave under §2.4c legacy priors and ship-mode —
   clarinet/horn re-audit (L4), trumpet forte plosive (L9), flute (L7),
   sax mids (L6/L10) are the owner's open ears.
5. §2.4c + §2.5c.6 adoption for every blown preset you touch.
Begin now. Merge green work to codex/sg2-l4-l5-engine every pass.
