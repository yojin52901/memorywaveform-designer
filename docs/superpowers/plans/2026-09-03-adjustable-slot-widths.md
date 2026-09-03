# Adjustable Slot Widths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let designers resize a timeline gap by drag while every waveform and relation projection updates live and the presentation-only width persists in JSON.

**Architecture:** Keep semantic marker sequence unchanged. Add `presentation.slotWidthUnits` as a boundary-keyed visual multiplier, calculate all horizontal geometry in a shared timeline-layout module, and render transient width overrides during a resize drag. Commit the persistent presentation change once on pointerup; discard it on pointercancel.

**Tech Stack:** ES modules, native SVG and Pointer Events, Node `node:test`, existing static Worker build.

**Spec:** `docs/superpowers/specs/2026-09-03-adjustable-slot-widths-design.md`

## Global Constraints

- Width is presentation-only and must never alter marker `sequence`, timing requirements, phase/timing endpoint IDs, or annotation anchors.
- `presentation.slotWidthUnits` uses leading boundary IDs, defaults absent entries to `1`, and accepts only finite `0.4..4` values.
- `timelineStart` may be a key; `timelineEnd` and deleted marker IDs may not remain keys.
- Existing JSON without `slotWidthUnits` stays schema `1.1` and renders equal-width gaps.
- Drag preview must redraw related x geometry immediately without writing document/history until pointerup.
- No external dependencies; use existing Node test runner and deployed Worker build.

---

## File Structure

- `src/domain/constants.js`: central base width and permitted unit bounds.
- `src/domain/document.js`: new-document presentation default.
- `src/domain/operations.js`: persistent width update and stale-key cleanup during marker removal.
- `src/domain/validate.js`: contract validation for optional width settings.
- `src/render/timeline-layout.js`: shared, pure horizontal geometry builder used by renderer and controller.
- `src/render/svg-renderer.js`: all x projection and resize-handle markup.
- `src/ui/controller.js`: pointer lifecycle, preview rerender, and layout-aware sequence targeting.
- `tests/document.test.js`, `tests/operations.test.js`, `tests/validate.test.js`: presentation contract and lifecycle behavior.
- `tests/timeline-layout.test.js`, `tests/svg-renderer.test.js`, `tests/controller.test.js`: layout, render, and real drag lifecycle contracts.
- `docs/spec.md`, `README.md`, `CONTEXT.md`: product and terminology documentation.

### Task 1: Presentation Width Contract and Lifecycle

**Files:**
- Modify: `src/domain/constants.js`
- Modify: `src/domain/document.js`
- Modify: `src/domain/operations.js`
- Modify: `src/domain/validate.js`
- Modify: `tests/document.test.js`
- Modify: `tests/operations.test.js`
- Modify: `tests/validate.test.js`

**Interfaces:**
- Produces `BASE_SLOT_WIDTH = 150`, `SLOT_WIDTH_UNIT_MIN = 0.4`, and `SLOT_WIDTH_UNIT_MAX = 4`.
- Produces `setSlotWidth(document, { startMarkerId, widthUnits })`, returning a detached document with a six-decimal rounded presentation value.
- Produces `pruneSlotWidthUnits(document)`, retaining only `timelineStart` and extant time-marker IDs that have an outgoing gap.

- [ ] **Step 1: Write the failing document and domain tests**

```js
test('new documents initialize presentation slot widths', () => {
  assert.deepEqual(createDocument({ title: 'Program' }).presentation.slotWidthUnits, {});
});

test('saving a slot width is presentation-only and rounds to six decimals', () => {
  const updated = setSlotWidth(document, { startMarkerId: 'tm_start', widthUnits: 1.2345678 });
  assert.equal(updated.presentation.slotWidthUnits.tm_start, 1.234568);
  assert.deepEqual(updated.semantic, document.semantic);
});

test('removing a marker removes its stale outgoing slot-width entry', () => {
  const updated = deleteSignal(documentWithOnlyMarker, signalId);
  assert.equal('tm_removed' in updated.presentation.slotWidthUnits, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document.test.js tests/operations.test.js tests/validate.test.js`

Expected: FAIL because `slotWidthUnits` and `setSlotWidth` do not yet exist.

- [ ] **Step 3: Write the failing validator tests**

```js
test('rejects slot width entries with invalid boundary keys or values', () => {
  const document = validWaveform();
  document.presentation.slotWidthUnits = { tm_end: 1, tm_missing: 1, tm_start: 0.39 };
  const result = validateDocument(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /slot width.*boundary|slot width.*between 0.4 and 4/i);
});

test('allows legacy equal-width presentation with no slot width field', () => {
  const document = validWaveform();
  delete document.presentation.slotWidthUnits;
  assert.deepEqual(validateDocument(document), { valid: true, errors: [], warnings: [] });
});
```

- [ ] **Step 4: Run validation tests to verify it fails**

Run: `node --test tests/validate.test.js`

Expected: invalid keys and out-of-range values are currently accepted.

- [ ] **Step 5: Write minimal contract implementation**

```js
export const BASE_SLOT_WIDTH = 150;
export const SLOT_WIDTH_UNIT_MIN = 0.4;
export const SLOT_WIDTH_UNIT_MAX = 4;

export function setSlotWidth(document, { startMarkerId, widthUnits }) {
  const next = cloneDocument(document);
  // validate leading boundary, clamp to exported bounds, round six decimals,
  // then assign only next.presentation.slotWidthUnits[startMarkerId].
  return next;
}
```

Initialize `presentation.slotWidthUnits` to `{}`. Add `pruneSlotWidthUnits(next)` to `removeUnusedMarkers`, and validate optional width objects without requiring them from legacy documents.

- [ ] **Step 6: Run tests to verify GREEN**

Run: `node --test tests/document.test.js tests/operations.test.js tests/validate.test.js`

Expected: PASS; semantic objects remain unchanged and legacy documents stay valid.

- [ ] **Step 7: Commit**

```bash
git add src/domain/constants.js src/domain/document.js src/domain/operations.js src/domain/validate.js tests/document.test.js tests/operations.test.js tests/validate.test.js
git commit -m "feat: persist presentation slot widths"
```

### Task 2: Shared Timeline Layout and SVG Projection

**Files:**
- Create: `src/render/timeline-layout.js`
- Modify: `src/render/svg-renderer.js`
- Create: `tests/timeline-layout.test.js`
- Modify: `tests/svg-renderer.test.js`
- Modify: `tests/module-graph.test.js` only if the graph fixture needs an explicit new local-module assertion

**Interfaces:**
- Produces `createTimelineLayout(document, { slotWidthUnits = {} } = {})`.
- Layout result contains `leftX`, `endX`, `width`, `markerX`, ordered `gaps`, and `slotCoordinateForX(x)`.
- `renderSvg(document, { draft = false, slotWidthUnits } = {})` consumes a transient override without mutating `document`.

- [ ] **Step 1: Write failing layout tests**

```js
test('timeline layout defaults every gap to one unit', () => {
  const layout = createTimelineLayout(document);
  assert.equal(layout.markerX.get(firstMarker.id), 320);
  assert.equal(layout.markerX.get(secondMarker.id), 470);
});

test('a widened leading gap shifts all later markers without changing their sequence', () => {
  const layout = createTimelineLayout(document, { slotWidthUnits: { tm_start: 2 } });
  assert.equal(layout.markerX.get(firstMarker.id), 470);
  assert.equal(layout.markerX.get(secondMarker.id), 620);
  assert.deepEqual(document.semantic.timeline.timeMarkers.map((marker) => marker.sequence), [10, 30]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/timeline-layout.test.js`

Expected: FAIL because `timeline-layout.js` does not exist.

- [ ] **Step 3: Write minimal layout implementation**

```js
export function createTimelineLayout(document, { slotWidthUnits = {} } = {}) {
  // Order timelineStart, markers by sequence, then timelineEnd.
  // Resolve each leading-boundary unit from overrides, document presentation, or 1.
  // Accumulate x positions from leftX and BASE_SLOT_WIDTH.
  // Return markerX plus a coordinate conversion that uses the same gaps.
}
```

Use immutable boundary IDs as gap keys. Keep `timelineEnd` as a terminal boundary only; never give it an outgoing width.

- [ ] **Step 4: Run test to verify GREEN**

Run: `node --test tests/timeline-layout.test.js`

Expected: PASS with default and widened-marker geometry.

- [ ] **Step 5: Write failing renderer integration test**

```js
test('a slot width override moves waveform, timing, and phase projections together', () => {
  const svg = renderSvg(documentWithTimingAndPhase, { slotWidthUnits: { tm_start: 2 } });
  assert.match(svg, /data-slot-resize-start-marker-id="tm_start"/);
  assert.match(svg, /class="transition-target"[^>]*cx="470"/);
  assert.match(svg, /class="timing-connector start"[^>]*x1="470"[^>]*x2="470"/);
  assert.match(svg, /data-relation-kind="phase"[\s\S]*cx="470"/);
});
```

- [ ] **Step 6: Run renderer tests to verify RED**

Run: `node --test tests/svg-renderer.test.js`

Expected: FAIL because the renderer still derives every x from a fixed marker gap and emits no resize handle.

- [ ] **Step 7: Route SVG x geometry through the layout**

Replace index-based `markerGap` arithmetic with `createTimelineLayout`. Render one top-ruler handle per outgoing gap with `data-slot-resize-start-marker-id`, `data-slot-start-x`, and `data-slot-width-units`; keep its hit target above the marker-column line and relation controls. Emit the layout coordinate data needed by the controller without serializing semantic references as pixel positions.

- [ ] **Step 8: Run tests to verify GREEN**

Run: `node --test tests/timeline-layout.test.js tests/svg-renderer.test.js tests/module-graph.test.js`

Expected: PASS; renderer output contains synchronized x geometry and reachable module graph remains complete.

- [ ] **Step 9: Commit**

```bash
git add src/render/timeline-layout.js src/render/svg-renderer.js tests/timeline-layout.test.js tests/svg-renderer.test.js tests/module-graph.test.js
git commit -m "feat: render adjustable timeline slots"
```

### Task 3: Resize Drag Preview and Commit Lifecycle

**Files:**
- Modify: `src/ui/controller.js`
- Modify: `tests/controller.test.js`

**Interfaces:**
- `sequenceFromPointer(svg, event, documentModel)` resolves a visual coordinate through `createTimelineLayout`.
- `slotWidthFromPointer(svg, event, drag)` returns a clamped unit derived from `data-slot-start-x` and pointer SVG x.
- `bindCanvasPointerEvents` accepts a canvas-preview callback that replaces only waveform SVG markup, rebinds events, and transfers pointer capture.

- [ ] **Step 1: Write failing resize interaction tests**

```js
test('slot resize pointer moves repaint the connected SVG before committing', () => {
  // pointerdown a data-slot-resize-start-marker-id handle, then pointermove twice
  // assert two preview SVG renders and no applyOperation calls
});

test('slot resize commits one presentation update on pointerup and cancels atomically', () => {
  // pointerup asserts setSlotWidth receives the final clamped unit once;
  // pointercancel asserts no applyOperation call and restored rendering.
});

test('sequence targeting follows widened slot geometry', () => {
  assert.equal(sequenceFromPointer(widenedSvg, { clientX: 470 }, document), 1);
  assert.equal(sequenceFromPointer(widenedSvg, { clientX: 620 }, document), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/controller.test.js`

Expected: FAIL because slot resize handles are not recognized and pointer conversion assumes a fixed 150-unit gap.

- [ ] **Step 3: Implement the minimal drag state**

On `pointerdown`, detect `[data-slot-resize-start-marker-id]` before marker and transition targets. Store `kind: 'slot-width'`, leading boundary ID, initial unit, and pointer capture. On each `pointermove`, calculate the preview unit, invoke the canvas-only preview renderer with `{ ...document.presentation.slotWidthUnits, [startMarkerId]: previewUnit }`, rebind to the replacement SVG, and retain pointer capture. Reapply drag status after each preview.

- [ ] **Step 4: Commit only on release or discard on cancel**

```js
if (drag.kind === 'slot-width') {
  applyOperation((documentModel) => setSlotWidth(documentModel, {
    startMarkerId: drag.startMarkerId,
    widthUnits: drag.widthUnits
  }));
  return;
}
```

On cancel, clear the transient width override and call normal render without `setSlotWidth`. Use the shared layout for subsequent transition and marker `sequenceFromPointer` calculations.

- [ ] **Step 5: Run test to verify GREEN**

Run: `node --test tests/controller.test.js`

Expected: PASS; preview is immediate, commit is once, cancellation leaves the document untouched, and existing timing/endpoint drag contracts still pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/controller.js tests/controller.test.js
git commit -m "feat: drag to resize timeline slots"
```

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/spec.md`
- Test: all repository tests and deployment build

**Interfaces:**
- Documents `presentation.slotWidthUnits` as visual-only, JSON-persistent layout information.
- Preserves the existing rule that downstream consumers never infer engineering time from presentation or PNG.

- [ ] **Step 1: Update user-facing contract documentation**

Add a concise authoring instruction for dragging timeline gap handles. Update the core specification to state default width, persistence, and non-semantic status; update glossary context to distinguish an order slot from its visual gap width.

- [ ] **Step 2: Run full local verification**

Run: `node --test && find src tests -name '*.js' -print0 | xargs -0 -n1 node --check && git diff --check && rg -n '\[DEBUG-' src tests`

Expected: all tests pass, syntax and whitespace checks pass, and debug-tag search returns no matches.

- [ ] **Step 3: Review source and commit documentation**

```bash
git add README.md CONTEXT.md docs/spec.md
git commit -m "docs: describe adjustable slot widths"
```

- [ ] **Step 4: Publish verified source**

Push the feature branch with a non-force fast-forward update. Synchronize the exact changed source and tests into the existing Sites source repository, run `node --test`, run `node scripts/build.mjs`, package with the Sites helper, save one version, deploy using the verified owner-only access path, and poll deployment status to terminal success.

