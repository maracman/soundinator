# Hosting & monetisation strategy — "is there a path?" (owner decision, nothing built)

Companion to [HOSTING_PLAN.md](HOSTING_PLAN.md), which is the operational
runbook (static hosting + Supabase + cost guardrails). This document is
the strategic analysis the owner asked for.

## Short answer

Yes, there is a path — but it is a **community-and-niche path, not a
mass-market one**, and its engine is the thing no competitor has: sounds
and songs here are *parameters with provenance*, not audio files.

## The moat

A shared **patch/arrangement library with attribution and remixing**:

- Every patch and arrangement is a small JSON object (seed + params).
  Sharing costs nothing (HOSTING_PLAN.md: shares are JSON, not audio),
  and every derivative can carry its lineage — "remixed from X by Y" is
  a *foreign key*, not a legal claim. Attribution-native remixing is
  something SoundCloud/Splice structurally cannot do, because they trade
  in rendered audio.
- Determinism means a remix diff is legible: "they raised surprise and
  moved it to 19-EDO" is inspectable, teachable content.
- Network effect: the library is the product; the studio is the reader
  for it.

## The offer

| Tier | Contents | Why people pay |
|---|---|---|
| **Free** | Full studio + producer, public library, public sharing with attribution | The instrument must be free — the library only grows if creation is frictionless |
| **Paid personal** (~$4–6/mo) | Private patches/arrangements, WAV/stem export presets, larger storage | Privacy and convenience, never capability |
| **Education/research** (site licence) | Class workspaces, assignment templates, anonymised class-level analytics, DOI-citable stimulus sets | This is the differentiated niche — see below |

Never paywall: the engine, the number of tracks, the audio quality.
Paywalling capability kills the library that is the moat.

## The niche that actually pays

**Research & education**, not prosumers:

- The app already produces *citable stimuli* (stimulus_id provenance,
  APP_VERSION forking, deterministic regeneration). No commercial DAW can
  make that claim; music-cognition labs currently hand-roll this.
- Psychoacoustics / music-cognition methods courses need exactly this:
  parameterised, reproducible, expectancy-controllable stimuli with
  export-to-analysis. A handful of site licences out-earns thousands of
  hobbyist subscriptions and matches the project's identity.
- The public community library doubles as a stimulus commons —
  research use feeds the moat rather than competing with it.

## Sequencing (aligns with HOSTING_PLAN.md's phased rollout)

1. Free launch, public library, attribution/remix graph from day one
   (the graph cannot be retrofitted onto anonymous content).
2. Watch two numbers only: remix rate (moat forming?) and returning
   creators. Ignore raw traffic.
3. Add paid personal tier when storage costs are real (they will be tiny;
   this tier is pocket money and a commitment signal).
4. Approach 2–3 music-cognition labs / conservatoire methods courses
   directly for pilot site licences — this is founder sales, not
   self-serve.

## Honest risks

- **Niche size.** Music-cognition education is small. The path is
  sustainable-project-sized, not startup-sized.
- **The library cold start.** Attribution-remixing is worthless with 30
  patches. Mitigation: the factory/measured presets seed it, and every
  research stimulus set published with a paper is free content.
- **Support load.** Site licences imply support expectations; price them
  accordingly.

**Recommendation:** take the free-launch steps (they cost ~nothing and
are already specced operationally), defer any payment infrastructure
until remix rate proves the moat, and spend the saved effort on the
education pilot conversations.
