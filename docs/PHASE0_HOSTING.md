# Phase 0 Hosting

The Phase 0 web app is designed to be sent to people freely. Visitors can adjust the synth, audition a rendered preset, save private presets in their browser, and offer any current preset directly to the shared research library.

## Local Run

```bash
PYTHONPATH=src python3 -m synthesiser.web.server --host 127.0.0.1 --port 8765
```

Open `http://127.0.0.1:8765`.

## Hosted Run

The app reads standard hosting environment variables:

- `PORT`: server port supplied by the host
- `HOST`: bind address, usually `0.0.0.0`
- `PHASE0_DATA_DIR`: persistent data directory for `global_presets.json` and session logs
- `PHASE0_CACHE_DIR`: render cache directory for generated WAV/JSON sidecars

Example:

```bash
HOST=0.0.0.0 PORT=8765 PHASE0_DATA_DIR=/data/phase0 PYTHONPATH=src python3 -m synthesiser.web.server
```

`Procfile` is included for simple platforms that support process files:

```text
web: PYTHONPATH=src python3 -m synthesiser.web.server --host 0.0.0.0
```

For public collection, make sure `PHASE0_DATA_DIR` is backed by persistent storage. Ephemeral dyno/container disks will lose the global library on restart.

## Community Preset Flow

1. Visitor adjusts parameters and presses `Play`.
2. The server renders/caches the WAV using the same Python synth path used by the research pipeline.
3. Visitor may press `Save preset` to keep a private browser-local copy.
4. Visitor may tick consent and press `Offer current preset` at any time.
5. The server appends the submitted preset to `global_presets.json`.

The submitted entry stores the parameter schema, stable preset hash, audio URL, sidecar URL, optional alias/notes, rating, schema version, and synth-version hash.
