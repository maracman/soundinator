# Smart dropdown — reusable searchable picker

A small, framework-free component for choosing one value from a (possibly long,
grouped) list. It is the standard control for **preset / patch / enum pickers**
across Resona. Use it instead of a bare `<select>` whenever the option set is
long enough to want a search box, benefits from group headers, or needs richer
option rows (a name plus a secondary note).

- **Source**: `smartComboHTML()` + `wireSmartCombos()` in `web/static/app.js`
- **Styles**: `.smart-combo*` in `web/static/styles.css`
- **First adopter**: the percussion layer sound picker (macro → Percussion),
  where every layer gets its own instance.

## Why it exists

The scale picker (`.scale-combo`, `#scaleCombo` in app.js) already did
search-inside-a-popover, but it was single-instance: hard-coded element ids and
one shared `window._scaleComboDocClick` outside-click handler. You cannot drop
two of it on a page. `smartCombo` is the same interaction generalised to be
**multi-instance** (class/data selectors, one outside-click listener per
element), so N pickers coexist. `.scale-combo` is the prototype and a natural
future migration target; it is intentionally left untouched for now.

## API

### `smartComboHTML(opts) → htmlString`

| option | meaning |
|---|---|
| `id` | optional DOM id for the wrapper (route selections back by reading it / `data-*`) |
| `value` | the currently selected option value (marks it `.sel`) |
| `buttonLabel` | text shown on the closed button (usually the current selection's label) |
| `placeholder` | search-box placeholder + closed-button fallback text |
| `groups` | `[{ label, options }]`; a falsy `label` renders the options with no header |

Each option: `{ value, label, note?, title?, selected? }` — `note` is a dim
right-aligned annotation (e.g. a tag/kind), `title` a hover tooltip, `selected`
forces the selected state independent of `value`.

### `wireSmartCombos(root, onSelect)`

Call once after inserting markup under `root` (idempotent — already-wired
instances are skipped, so it is safe to call after partial re-renders). On pick:
updates the button label, sets `combo.dataset.comboValue`, moves the `.sel`
marker, closes the popover, then calls `onSelect(comboEl, value)`. Encode which
control a combo belongs to via its `id`/`data-*` and read it back in `onSelect`.

## Behaviour

- **Search** filters options live by case-insensitive substring of the visible
  text; group headers with no visible children hide themselves.
- **Single-open**: opening one combo closes any other open combo.
- **Outside-click** (capture phase, scoped to the element) closes the popover;
  each instance manages its own listener and removes it on close (no leaks, no
  global singleton).
- **Keyboard**: the search box autofocuses on open; typing filters. (Full
  arrow-key roving is a future enhancement — options are real `<button>`s so
  they are already tab/enter reachable.)

## Example

```js
container.innerHTML = smartComboHTML({
  id: `snd-${layer.id}`,
  value: currentValue,
  buttonLabel: currentLabel,
  placeholder: "Search sounds…",
  groups: [
    { label: "Samples", options: sampleOpts },       // {value,label,note:"sample"}
    { label: "Sub-note instruments", options: instrumentOpts },
  ],
});
wireSmartCombos(container, (combo, value) => {
  const id = combo.id.replace("snd-", "");
  applySoundChoice(id, value);
});
```

## Where to use it

Any long/grouped preset or enum picker. Candidates to migrate as they are next
touched: the panel preset bars (`panel-presets`), reverb/scale selectors, effect
face presets, and the generic `param-select` control.
