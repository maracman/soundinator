# Layer unification implementation notes

- `params.js` owns the canonical shape, migration, engine adapter, and
  temporary dual-write serializer.
- `app.js` installs non-enumerable compatibility accessors on studio state.
  Existing sound-control code can continue using `exploreParams.<key>`, but
  each read/write is routed to the selected `layers[n].sound`. These accessors
  are transient and never appear in serialization or engine parameters.
- The sub-note preview now constructs one temporary `preview` layer instead of
  nulling the stack and spreading a flat sound half.
- The spatial stage, compact layer pads, producer layer inspector, effects
  racks, preset drops, and capture-part saves all read the unified layer list.
- Percussion remains top-level and belongs to the note engine.
- `subnote` remains accepted as a read alias during migration and in the
  synthesis adapter.
- WP-5 cleanup is intentionally deferred until the owner-triggered production
  soak described in `LAYER_UNIFICATION_PLAN.md`.
