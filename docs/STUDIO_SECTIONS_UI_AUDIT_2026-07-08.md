# Studio Sections UI Audit - 2026-07-08

Scope: Macro, Sub-note, and Scale Lab. Producer mode is covered separately in
`docs/PRODUCER_UI_AUDIT_2026-07-08.md`.

Constraint: do not add controls, panels, or workflows. This pass is visual and
ergonomic polish only.

## Summary

The non-producer studio sections already have a strong base. Macro is shaped
like a behaviour workstation, Sub-note is a serious tone designer, and Scale Lab
has the right workshop layout. The main opportunity is consistency: the screens
should read as one professional instrument rather than three related but uneven
surfaces.

The low-hanging fruit is mostly in contrast, active states, panel depth, and
control metrics. The app uses a fixed plugin canvas, so small changes to border
clarity, selected-state strength, and text contrast matter a lot.

## Findings

1. The top chrome is too faint in places.
   The app title, workspace tabs, and transport controls are compact, which is
   right, but several labels and inactive states read softer than a production
   tool should. Active workspace state should be obvious at a glance.

2. Macro has the right structure but needs stronger operational hierarchy.
   The rail, inspector, visual field, and preset strip are all correct. The rail
   buttons and inspector panel need more disciplined contrast so the active
   mechanism feels selected, not merely tinted.

3. Sub-note is visually close, but the signal-chain cards can feel muddy.
   Excitor, Resonator, Body, and Space are meaningful stages. Their active,
   hover, and disabled states should be cleaner and more physical. The inspector
   and partial-field surfaces benefit from tighter borders and darker wells.

4. Scale Lab needs more workshop clarity.
   The wheel and side panels work, but the selected preset, side panels, chips,
   and degree inspector are low contrast. Scale nodes and keyboard mapping should
   feel sharper without changing their geometry.

5. Preset strips are useful but under-weighted.
   The existing preset cards in Macro and Sub-note are the selection surface.
   They should have clearer selected/hover states and readable miniature traces.

6. The whole studio should reduce the “old layered CSS” feeling.
   Several visual eras are present at once: older card styles, later CHORDA
   styles, macro-v2 styles, and Scale Lab styles. A scoped final-pass CSS layer
   can harmonise them without touching functionality.

## Implementation Plan

- Keep all existing DOM roles, IDs, handlers, canvas sizes, and controls.
- Add only CSS overrides scoped to `.explore-dashboard`.
- Strengthen active workspace tabs and transport chrome.
- Improve panel surfaces, borders, dark wells, and section-label readability.
- Sharpen Macro rail, inspector, chips, visual field, and preset strip.
- Sharpen Sub-note chain cards, active stage borders, inspector, partial field,
  side panel, status strip, and sound browser cards.
- Sharpen Scale Lab side panels, preset rows, chips, node states, degree editor,
  and keyboard mapping well.
- Verify all three workspaces visually and run the focused web tests.
