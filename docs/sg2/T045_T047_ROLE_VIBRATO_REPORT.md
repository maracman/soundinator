# T-045–T-047 violin role/vibrato report

Date: 2026-07-16

## Role-aware corpus

`strings_prep` now emits explicit roles and two external contracts:

- `coverage-contract.json`;
- `vibrato-contract.json`.

The rebuilt manifest has 26 references: six spectral/onset, six vibrato,
and fourteen floor. All six vibrato-role takes contain measured vibrato.
The exact emitted table is:

| Register | Dynamic | MIDI | Probability | Rate Hz | Depth cents |
|---|---|---:|---:|---:|---:|
| low | mf | 55 | 1.0 | 6.579590 | 12.154593 |
| low | f | 55 | 1.0 | 5.598633 | 7.618154 |
| mid | mf | 76 | 1.0 | 5.617357 | 33.992736 |
| mid | f | 76 | 1.0 | 5.699966 | 34.118302 |
| high | mf | 93 | 1.0 | 6.251575 | 37.934735 |
| high | f | 93 | 1.0 | 6.333295 | 34.986902 |

The campaign seed carries this as `vibratoByRegisterDynamic`; the present
engine ignores it pending T-047.

## Gate effect

Role routing changes the gate from 40 failures with seven holes to 31
failures with zero holes. It removes floor leakage and replaces synthetic
vibrato obligations with six measured cells.

The rate-first pass accepts `vibratoRate = 5.431206`:

- mid/mf and mid/f pass;
- low/mf, low/f, high/mf, and high/f remain failing;
- total gates improve 31→30.

Probability probes from 0.38–0.88 and depth probes from about 19–49 cents
did not close a cell. The residual demonstrates that one global tuple cannot
fit the measured register/dynamic table.

## Repeat stability

The isolated audit is clean after quarantining inharmonicity:

- repeat mean: 0.016252;
- repeat peak: 0.084365;
- threshold: 0.05;
- final inharmonicity weight: 0.

All other weighted features retain responders.

## Local optimizer blocker resolved

One probability probe produced no stable pitched note at high/pp. The old
optimizer aborted. Candidates now record `analysisFailures`, receive a hard
gate plus loss penalty, and remain visible in the loss curve instead of
terminating the session.

## External blockers

Further progress requires the T-047 vibrato table consumer plus the already
filed T-029/T-033/T-031/T-039 consumers. The corpus and analysis-side
contracts are ready.
