You are Agent D on the Sound Generator 2.0 project (repo = current directory).
Lane: the ANALYSIS INFRASTRUCTURE (scripts/tone_match/** — you are its owner
and every other lane's supplier) plus the BOWED campaign (violin, cello).
Read docs/sg2/AGENT_OPERATING_PROTOCOL.md FIRST and follow its read order; it
is your contract. Fresh context: your predecessor completed the L14 bow-noise
extraction (pinned profiles, synthetic round-trip validated) and T-040
low-mode body recovery; both are merged at HEAD.

Priorities, in order (from the owner-commissioned integration audit):
1. IMPLEMENT §2.4c + §2.5c.6 IN THE CANONICAL STACK — the top
   owner-audibility gap. iterate.py: legacy-prior initialisation from the
   §2.4c lookup table (tag sg2-legacy), legacy baseline as mandatory
   leaderboard entry #1, prior row + hash in run reports; ship-mode vs
   fit-mode split; the two-sided distributional variation gate (N seeded
   ship-mode variants vs measured take-pair spread). Every lane inherits
   this from you — land it before any further violin refinement.
2. Fix the d.12 latent bug: assertions.py still models `contrabass` as a
   fitted target; ALIASES won't normalise voice-bass/voice-soprano →
   sung construction gates silently skip. Add the four section-type
   classes; basso profondo becomes a derived-preset row.
3. Add the L9 manifest key (articulationVelocitySlope) — Agent A is told
   to coordinate with you.
4. §2.5c differential fits for violin (your take-pairs.json exists; the
   fits were never run — F3). Emit humanRanges into the profile; report
   the decomposition-test verdict. Cello: state the proxy basis.
5. Resume the violin loop as Agent A lands your pending engine consumers
   (T-031/T-054/T-029/T-039/T-047/T-048) — re-audit controllability per
   engine commit, rebaseline, iterate under ship-mode. Your measurement
   side is done; the sound moves when the consumers land.
6. Reconcile your exchange statuses against code (F6 — T-036 and the
   sung-entry acks breached the staleness tripwire).
Begin now. Merge green work to codex/sg2-l4-l5-engine every pass.
