# T-048 violin onset report

Date: 2026-07-16

## Analysis correction

The previous lock-in feature waited for absolute harmonic amplitude to reach
half its sustain value. That measured slow player crescendos as late
Helmholtz lock-in. The corrected feature measures harmonic share relative to
local noise and requires 80% of the sustain share for three STFT frames.

A synthetic harmonically stable tone with a one-second amplitude bloom now
locks within five periods. The six selected Iowa onset references all clear
the dossier ceiling:

| Register | Dynamic | MIDI | Mean band T90 ms | Lock-in periods |
|---|---|---:|---:|---:|
| low | pp | 55 | 286.848 | 0.000 |
| low | ff | 55 | 195.270 | 15.891 |
| mid | pp | 79 | 203.110 | 0.000 |
| mid | ff | 79 | 261.489 | 0.000 |
| high | pp | 88 | 59.508 | 15.351 |
| high | ff | 88 | 228.231 | 0.000 |

`strings_prep` emits these as six dedicated onset-role rows plus
`attack-contract.json`. Spectral, vibrato, onset, and floor evidence no
longer share custody accidentally.

## Register-only rejection

The tripwire accepts ±30% of the reference mean or ±20 ms. The high-register
intervals are:

- pp: 39.508–79.508 ms;
- ff: 159.762–296.700 ms.

They do not overlap. A single high-register attack value cannot satisfy both
dynamics, so T-038's register-only form is insufficient for bowed strings.
The emitted consumer contract is `envelopeAttackByRegisterDynamic`.

## Rebaseline

Authoritative run:
`/private/tmp/sg2/violin/agentd-t048-onset-rebaseline-r1`

- loss: 3.541721 (new objective; not comparable with T-046);
- total failures: 30;
- tripwire failures: 28;
- construction failures: 2;
- strict evidence holes: 0;
- onset-lockin construction: pass, median 0 periods.

The isolated controllability audit is clean and repeat-stable:

- objective hash: `e848934b2568dfe1`;
- manifest hash: `aadead63bf3ab802`;
- maximum attack repeat peak: 0.035714 perceptual units;
- maximum inharmonicity repeat peak: 0.007259;
- quarantined features: none.

## Consumer evidence

The current renderer was probed at high/ff with and without the emitted
table. Across three repeats both variants measured exactly 53.0 ms mean
band-T90 and their attack distance was 0.0 ms. Small whole-file PCM
differences remained within the known repeat-render floor. The new table is
therefore not consumed yet.

Further attack closure is blocked on the T-048 engine consumer, not corpus
coverage or analysis stability.
