# Multi-transition Timing Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each timing-parameter endpoint reference a selected subset of synchronous transitions, render vertical connections to every referenced transition, and make vertical overlay dragging continuous and free of pointer-offset jumps.

**Architecture:** Schema `1.1` makes plural transition-ID arrays the sole timing-endpoint representation and migrates known `1.0` documents at import and history boundaries. Pure domain helpers enforce endpoint invariants before mutations; the Inspector edits same-slot subsets, while the SVG renderer projects connectors and the controller owns pointer interaction only.

**Tech Stack:** Native JavaScript ES modules, SVG, browser Pointer Events and FormData, Node.js built-in test runner, localStorage.

**Spec:** `docs/superpowers/specs/2026-08-31-multi-transition-timing-endpoints-design.md`

## Global Constraints

- Timing parameters use `startTransitionIds` and `endTransitionIds`; phase fields remain singular.
- Every endpoint is a non-empty, duplicate-free subset of one order slot.
- The start order slot is strictly earlier than the end order slot.
- Known schema `1.0` documents migrate deterministically to `1.1`; unknown versions and malformed references are not guessed or repaired.
- Requirement text remains a free-form note and never affects validity.
- Timing vertical position remains normalized presentation data, never semantic pixel data.
- Existing feature work stays on `feat/structured-waveform-editor-mvp`; do not create another worktree unless the user changes this instruction.

## File Structure

- Create `src/domain/migrate.js`: deterministic document-version migration only.
- Create `src/domain/timing-endpoints.js`: timing-endpoint resolution, validation, and reference predicates.
- Modify `src/domain/constants.js`: advance the current schema version to `1.1`.
- Modify `src/domain/operations.js`: plural timing endpoints, safe mutations, dependency and deletion behavior, six-decimal position storage.
- Modify `src/domain/validate.js`: validate the canonical timing-endpoint contract.
- Modify `src/domain/import-export.js`: migrate before validation and export only canonical documents.
- Modify `src/ui/document-history.js`: migrate known snapshots as they are loaded.
- Modify `src/ui/controller.js`: checkbox subsets, endpoint rebind behavior, and grab-offset drag math.
- Modify `src/render/svg-renderer.js`: multi-reference connector projection and unrounded y positioning.
- Modify `tests/*.test.js`: public-behavior regression coverage.
- Modify `docs/spec.md` and `README.md`: document schema `1.1` and the final interaction.

---

### Task 1: Deterministic legacy-document migration

**Files:**
- Create: `src/domain/migrate.js`
- Create: `tests/migrate.test.js`

**Interfaces:**
- Produces: `migrateDocument(document) -> { document, migrated }`
- Consumes: `cloneDocument(document)` from `src/domain/document.js`
- Does not yet change the live editor schema; Task 2 integrates this tested boundary atomically with the canonical model.

- [ ] **Step 1: Write failing pure migration tests**

Build a minimal schema `1.0` object with singular timing fields and assert a cloned canonical result:

```js
test('migrates schema 1.0 timing fields without mutating the source', () => {
  const source = {
    schemaVersion: '1.0',
    semantic: { timingParameters: [{ id: 'tp_1', startTransitionId: 'tr_a', endTransitionId: 'tr_b' }] }
  };
  const result = migrateDocument(source);
  assert.equal(result.migrated, true);
  assert.equal(result.document.schemaVersion, '1.1');
  assert.deepEqual(result.document.semantic.timingParameters[0].startTransitionIds, ['tr_a']);
  assert.deepEqual(result.document.semantic.timingParameters[0].endTransitionIds, ['tr_b']);
  assert.equal('startTransitionId' in result.document.semantic.timingParameters[0], false);
  assert.equal(source.semantic.timingParameters[0].startTransitionId, 'tr_a');
});

test('leaves unknown schema versions unchanged for validation to reject', () => {
  const source = { schemaVersion: '2.0', semantic: { timingParameters: [] } };
  assert.deepEqual(migrateDocument(source), { document: source, migrated: false });
});
```

Also test that a malformed timing entry is preserved rather than guessed and that existing plural arrays are not overwritten during `1.0` migration.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/migrate.test.js`

Expected: FAIL with module-not-found for `src/domain/migrate.js`.

- [ ] **Step 3: Implement deterministic migration**

Create `src/domain/migrate.js`:

```js
import { cloneDocument } from './document.js';

export function migrateDocument(source) {
  const document = cloneDocument(source);
  if (document?.schemaVersion !== '1.0') return { document, migrated: false };
  for (const parameter of document.semantic?.timingParameters ?? []) {
    if (!parameter || typeof parameter !== 'object') continue;
    if (!Array.isArray(parameter.startTransitionIds) && 'startTransitionId' in parameter) {
      parameter.startTransitionIds = [parameter.startTransitionId];
    }
    if (!Array.isArray(parameter.endTransitionIds) && 'endTransitionId' in parameter) {
      parameter.endTransitionIds = [parameter.endTransitionId];
    }
    delete parameter.startTransitionId;
    delete parameter.endTransitionId;
  }
  document.schemaVersion = '1.1';
  return { document, migrated: true };
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/migrate.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS because the migration helper is not yet connected to the live schema.

- [ ] **Step 5: Commit the migration unit**

```bash
git add src/domain/migrate.js tests/migrate.test.js
git commit -m "feat: add timing endpoint schema migration"
```

### Task 2: Plural timing-endpoint operations and validation

**Files:**
- Create: `src/domain/timing-endpoints.js`
- Modify: `src/domain/constants.js`
- Modify: `src/domain/operations.js`
- Modify: `src/domain/validate.js`
- Modify: `src/domain/import-export.js`
- Modify: `src/ui/document-history.js`
- Modify: `src/render/svg-renderer.js`
- Modify: `src/ui/controller.js`
- Modify: `tests/operations.test.js`
- Modify: `tests/validate.test.js`
- Modify: `tests/import-export.test.js`
- Modify: `tests/document-history.test.js`
- Modify: `tests/svg-renderer.test.js`
- Modify: `tests/controller.test.js`

**Interfaces:**
- Produces: `resolveTimingEndpoint(document, transitionIds, label) -> { transitions, markerId, sequence }`
- Produces: `assertTimingEndpoints(document, startTransitionIds, endTransitionIds) -> void`
- Produces: `timingParameterReferencesTransition(parameter, transitionId) -> boolean`
- Updates: `addTimingParameter` and `updateTimingParameter` accept plural arrays only.
- Consumes: `migrateDocument(document)` at JSON-import and history-read boundaries.
- Consumes: `markerSequence(document, markerId)` semantics already used by domain operations.

- [ ] **Step 1: Convert fixture builders to plural fields and add failing invariant tests**

Replace timing creation calls with:

```js
addTimingParameter(document, {
  name: 'tWP',
  startTransitionIds: [start.id],
  endTransitionIds: [end.id],
  requirementText: '>= 20 ns'
});
```

Add tests for a valid two-transition start endpoint, duplicate IDs, cross-slot IDs, an empty endpoint, a dangling ID, and reversed start/end slots:

```js
function transitionsAt(document, sequence) {
  const marker = document.semantic.timeline.timeMarkers.find((item) => item.sequence === sequence);
  return marker.transitionIds.map((id) => document.semantic.transitions.find((item) => item.id === id));
}

function synchronousTwoSignalWaveform() {
  let document = createDocument({ title: 'Synchronous timing' });
  document = addSignal(document, { name: 'WE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const [we, ce] = document.semantic.signals;
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 10, rightState: 'LOW' });
  return setSegmentBoundary(document, { signalId: we.id, sequence: 30, rightState: 'HIGH' });
}

test('accepts a selected subset from one synchronous transition group', () => {
  const document = synchronousTwoSignalWaveform();
  const [startA, startB] = transitionsAt(document, 10);
  const [end] = transitionsAt(document, 30);
  const updated = addTimingParameter(document, {
    name: 'tSYNC', startTransitionIds: [startA.id, startB.id], endTransitionIds: [end.id]
  });
  assert.deepEqual(validateDocument(updated), { valid: true, errors: [], warnings: [] });
});
```

Add import and history integration assertions using a helper that converts a canonical fixture to schema `1.0` singular fields:

```js
function asLegacyDocument(document) {
  const legacy = structuredClone(document);
  legacy.schemaVersion = '1.0';
  for (const parameter of legacy.semantic.timingParameters) {
    parameter.startTransitionId = parameter.startTransitionIds[0];
    parameter.endTransitionId = parameter.endTransitionIds[0];
    delete parameter.startTransitionIds;
    delete parameter.endTransitionIds;
  }
  return legacy;
}

function legacyHistoryPayload(document) {
  const snapshot = asLegacyDocument(document);
  return { activeId: 'doc-1', entries: [{ id: 'doc-1', title: snapshot.metadata.title, updatedAt: 1, snapshot }] };
}

test('migrates schema 1.0 timing endpoints before validation', () => {
  const imported = loadDocumentJson(JSON.stringify(asLegacyDocument(validDocument())));
  assert.equal(imported.mode, 'editor');
  assert.equal(imported.document.schemaVersion, '1.1');
  assert.equal('startTransitionId' in imported.document.semantic.timingParameters[0], false);
});

test('migrates known legacy history snapshots on read', () => {
  const raw = legacyHistoryPayload(validDocument());
  const loaded = loadHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(raw) }), createHistoryEntry(validDocument()));
  assert.equal(loaded.history.entries[0].snapshot.schemaVersion, '1.1');
});
```

Also assert that an unknown `2.0` version remains in repair mode and a malformed `1.0` endpoint remains invalid after migration.

- [ ] **Step 2: Run the domain tests and verify RED**

Run: `node --test tests/operations.test.js tests/validate.test.js tests/import-export.test.js tests/document-history.test.js`

Expected: FAIL because operations and validation still read singular fields.

- [ ] **Step 3: Implement the endpoint domain helper**

Create `src/domain/timing-endpoints.js` with explicit errors:

```js
export function resolveTimingEndpoint(document, transitionIds, label = 'Timing endpoint') {
  if (!Array.isArray(transitionIds) || transitionIds.length === 0) throw new Error(`${label} must reference at least one transition.`);
  if (new Set(transitionIds).size !== transitionIds.length) throw new Error(`${label} may not contain duplicate transitions.`);
  const transitions = transitionIds.map((id) => document.semantic.transitions.find((item) => item.id === id));
  if (transitions.some((item) => !item)) throw new Error(`${label} references a missing transition.`);
  const markerIds = new Set(transitions.map((item) => item.markerId));
  if (markerIds.size !== 1) throw new Error(`${label} transitions must share one order slot.`);
  const markerId = transitions[0].markerId;
  const sequence = document.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId)?.sequence;
  if (!Number.isInteger(sequence)) throw new Error(`${label} references a missing order slot.`);
  return { transitions, markerId, sequence };
}

export function assertTimingEndpoints(document, startTransitionIds, endTransitionIds) {
  const start = resolveTimingEndpoint(document, startTransitionIds, 'Start endpoint');
  const end = resolveTimingEndpoint(document, endTransitionIds, 'End endpoint');
  if (!(start.sequence < end.sequence)) throw new Error('Timing endpoints must be strictly left-to-right.');
}

export function timingParameterReferencesTransition(parameter, transitionId) {
  return parameter.startTransitionIds.includes(transitionId) || parameter.endTransitionIds.includes(transitionId);
}
```

- [ ] **Step 4: Make arrays canonical across operations and validation**

Use cloned arrays in created and updated parameters:

```js
const parameter = {
  id: createId('tp'),
  name: name.trim(),
  startTransitionIds: [...startTransitionIds],
  endTransitionIds: [...endTransitionIds],
  requirementText,
  ...timingNoteMetadata(),
  tags: [...tags]
};
```

In `validateEndpointRelations`, keep the existing phase validation branch and validate timing parameters with `assertTimingEndpoints`, appending the thrown message to `errors`. Explicitly reject singular fields on schema `1.1` documents.

Mechanically update singleton reads in renderer and controller to `relation.startTransitionIds[0]` and `relation.endTransitionIds[0]`; checkbox and multi-connector behavior comes later.

Set `SCHEMA_VERSION` to `1.1`. In `loadDocumentJson`, call `migrateDocument` immediately after parsing and validate the returned document. In `loadHistory`, migrate each entry snapshot while cloning parsed storage; malformed history still follows the existing fallback path. Export remains validation-gated and therefore emits only canonical `1.1` documents.

- [ ] **Step 5: Run the focused tests and then the full suite**

Run: `node --test tests/operations.test.js tests/validate.test.js tests/import-export.test.js tests/document-history.test.js tests/svg-renderer.test.js tests/controller.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS with canonical `1.1` documents throughout.

- [ ] **Step 6: Commit the canonical endpoint model**

```bash
git add src/domain/constants.js src/domain/timing-endpoints.js src/domain/operations.js src/domain/validate.js src/domain/import-export.js src/ui/document-history.js src/render/svg-renderer.js src/ui/controller.js tests
git commit -m "feat: model timing endpoints as transition sets"
```

### Task 3: Preserve endpoint invariants through mutations and deletion

**Files:**
- Modify: `src/domain/operations.js`
- Modify: `tests/operations.test.js`

**Interfaces:**
- Produces: `rebindTimingEndpoint(document, { parameterId, endpoint, transitionId }) -> document`
- Updates: `moveTransition`, `moveMarker`, `getTransitionDependencies`, `deleteTransitionWithDependencies`
- Consumes: `assertTimingEndpoints` and `timingParameterReferencesTransition` from `src/domain/timing-endpoints.js`

- [ ] **Step 1: Write failing mutation tests**

Cover all mutation rules with public operations:

```js
function multiEndpointFixture() {
  let document = synchronousTwoSignalWaveform();
  const startTransitions = transitionsAt(document, 10);
  const endTransition = transitionsAt(document, 30)[0];
  document = addTimingParameter(document, {
    name: 'tSYNC',
    startTransitionIds: startTransitions.map((item) => item.id),
    endTransitionIds: [endTransition.id]
  });
  document = addSignal(document, { name: 'OE#', type: 'control', initialState: 'HIGH' });
  const oe = document.semantic.signals.find((item) => item.name === 'OE#');
  document = setSegmentBoundary(document, { signalId: oe.id, sequence: 20, rightState: 'LOW' });
  return {
    document,
    parameterId: document.semantic.timingParameters[0].id,
    selectedStart: startTransitions[0],
    newStart: transitionsAt(document, 20)[0]
  };
}

test('rebinding to another slot resets only that endpoint to the dropped transition', () => {
  const { document, parameterId, newStart } = multiEndpointFixture();
  const previousEndIds = document.semantic.timingParameters[0].endTransitionIds;
  const updated = rebindTimingEndpoint(document, { parameterId, endpoint: 'start', transitionId: newStart.id });
  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, [newStart.id]);
  assert.deepEqual(updated.semantic.timingParameters[0].endTransitionIds, previousEndIds);
});

test('rebinding within the current slot preserves the selected subset', () => {
  const { document, parameterId, selectedStart } = multiEndpointFixture();
  const previousStartIds = document.semantic.timingParameters[0].startTransitionIds;
  const updated = rebindTimingEndpoint(document, { parameterId, endpoint: 'start', transitionId: selectedStart.id });
  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, previousStartIds);
});
```

Also assert that moving one member out of a multi-member endpoint throws; moving the complete marker succeeds; dependency lookup finds any array member; cascade deletion removes only the ID when the endpoint remains non-empty; and cascade deletes the parameter, its annotation, lane order, and saved position when an endpoint would become empty.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/operations.test.js`

Expected: FAIL at missing `rebindTimingEndpoint` and old singular dependency logic.

- [ ] **Step 3: Implement rebind and move guards**

Implement endpoint rebind using the dropped transition's marker:

```js
export function rebindTimingEndpoint(document, { parameterId, endpoint, transitionId }) {
  if (!['start', 'end'].includes(endpoint)) throw new Error('Timing endpoint must be start or end.');
  const parameter = document.semantic.timingParameters.find((item) => item.id === parameterId);
  const target = document.semantic.transitions.find((item) => item.id === transitionId);
  if (!parameter || !target) throw new Error('Timing endpoint or transition does not exist.');
  const key = endpoint === 'start' ? 'startTransitionIds' : 'endTransitionIds';
  const current = resolveTimingEndpoint(document, parameter[key], `${endpoint} endpoint`);
  const ids = current.markerId === target.markerId ? parameter[key] : [transitionId];
  return updateTimingParameter(document, parameterId, { [key]: ids });
}
```

Before a single-transition move/update that changes the transition's order slot, detect multi-member endpoints containing that transition and throw `Move the timing endpoint selection before splitting its synchronous transitions.` A same-slot signal reassignment remains allowed because the endpoint stays synchronous. Apply the mutation to a clone and run `assertTimingEndpoints` for all timing parameters before returning. Marker moves validate after moving the complete group.

- [ ] **Step 4: Implement dependency-aware deletion**

Use `timingParameterReferencesTransition` in dependency lookup. During confirmed cascade, filter the deleted ID from both endpoint arrays. Retain a parameter if both arrays remain non-empty; otherwise delete it and clean its annotation, lane order, position, and dependent notice data exactly once. Preserve the existing phase cascade behavior.

- [ ] **Step 5: Verify mutation behavior**

Run: `node --test tests/operations.test.js tests/validate.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit invariant-preserving mutations**

```bash
git add src/domain/operations.js tests/operations.test.js
git commit -m "feat: preserve grouped timing endpoints during edits"
```

### Task 4: Same-slot endpoint checkboxes in the Inspector

**Files:**
- Modify: `src/ui/controller.js`
- Modify: `tests/controller.test.js`

**Interfaces:**
- Produces: `timingEndpointIdsFromForm(formData, endpoint) -> string[]`
- Consumes: `updateTimingParameter(document, parameterId, { startTransitionIds, endTransitionIds, ... })`
- Keeps: creation selects and canvas two-pick creation as singleton-array inputs.

- [ ] **Step 1: Write failing Inspector markup tests**

Build a timing parameter whose start endpoint selects two transitions at slot `#10`, then assert two checked checkboxes, no slot `#30` transition in the start group, and at least one checkbox required by controller validation:

```js
assert.match(markup, /data-endpoint-group="start"[\s\S]*Order slot #10/);
assert.equal((startGroup.match(/name="startTransitionIds"[^>]*checked/g) ?? []).length, 2);
assert.doesNotMatch(startGroup, /data-slot="30"/);
```

Add a pure FormData-like test:

```js
const formData = { getAll: (name) => name === 'startTransitionIds' ? ['tr_a', 'tr_b'] : [] };
assert.deepEqual(timingEndpointIdsFromForm(formData, 'start'), ['tr_a', 'tr_b']);
```

- [ ] **Step 2: Run the controller tests and verify RED**

Run: `node --test tests/controller.test.js`

Expected: FAIL because the Inspector still renders single selects and has no multi-value parser.

- [ ] **Step 3: Render endpoint checkbox groups**

Add a helper that resolves the endpoint's first transition, finds its marker, and renders only that marker's transitions in presentation signal order. Each checkbox uses the plural field name and checked membership:

```js
function timingEndpointCheckboxes(documentModel, parameter, endpoint) {
  const ids = parameter[`${endpoint}TransitionIds`];
  const first = documentModel.semantic.transitions.find((item) => item.id === ids[0]);
  const marker = documentModel.semantic.timeline.timeMarkers.find((item) => item.id === first?.markerId);
  const choices = (marker?.transitionIds ?? []).map((id) => documentModel.semantic.transitions.find((item) => item.id === id)).filter(Boolean);
  const checkboxes = choices.map((transition) => {
    const signal = documentModel.semantic.signals.find((item) => item.id === transition.signalId);
    const checked = ids.includes(transition.id) ? ' checked' : '';
    return `<label><input type="checkbox" name="${endpoint}TransitionIds" value="${escapeHtml(transition.id)}"${checked} />${escapeHtml(signal?.name ?? transition.signalId)} · ${escapeHtml(`${transition.fromState}→${transition.toState}`)}</label>`;
  }).join('');
  return `<fieldset data-endpoint-group="${endpoint}"><legend>${endpoint === 'start' ? 'Start' : 'End'} endpoint · Order slot #${marker.sequence}</legend>${checkboxes}</fieldset>`;
}
```

Use labels containing signal name and state change. Show a field-level notice and keep the document unchanged if either submitted array is empty.

- [ ] **Step 4: Parse all selected checkbox values**

Export the small helper for tests:

```js
export function timingEndpointIdsFromForm(formData, endpoint) {
  return formData.getAll(`${endpoint}TransitionIds`).map(String).filter(Boolean);
}
```

In the timing-edit submit branch, create one `FormData(form)` and pass both arrays to `updateTimingParameter`. In timing creation and canvas two-pick creation, wrap the selected IDs in one-element arrays.

- [ ] **Step 5: Verify Inspector behavior**

Run: `node --test tests/controller.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit the Inspector interaction**

```bash
git add src/ui/controller.js tests/controller.test.js
git commit -m "feat: edit synchronous timing endpoint subsets"
```

### Task 5: Render vertical connectors for every endpoint member

**Files:**
- Modify: `src/render/svg-renderer.js`
- Modify: `tests/svg-renderer.test.js`

**Interfaces:**
- Produces: SVG `.timing-connector` and `.timing-connection-mark` elements with `data-transition-id`
- Consumes: canonical timing endpoint arrays and the renderer's signal row order

- [ ] **Step 1: Write a failing multi-connector renderer test**

Create two start transitions in the same slot on different signals and one end transition. Assert connector counts and coordinates:

```js
function timingGroupFor(svg, parameterId) {
  return svg.match(new RegExp(`<g class="relation-lane timing"[^>]*data-relation-id="${parameterId}"[\\s\\S]*?</g>`))?.[0] ?? '';
}

function connectorTargetYs(group) {
  return new Set([...group.matchAll(/class="timing-connector (?:start|end)"[^>]*y2="([\d.]+)"/g)].map((match) => Number(match[1])));
}

const timingGroup = timingGroupFor(svg, parameter.id);
assert.equal((timingGroup.match(/class="timing-connector start"/g) ?? []).length, 2);
assert.equal((timingGroup.match(/class="timing-connector end"/g) ?? []).length, 1);
assert.match(timingGroup, new RegExp(`data-transition-id="${startA.id}"`));
assert.match(timingGroup, new RegExp(`data-transition-id="${startB.id}"`));
assert.ok(connectorTargetYs(timingGroup).size >= 2);
```

Also retain the assertion that signal rows occur before timing groups in the SVG source.

- [ ] **Step 2: Run the renderer tests and verify RED**

Run: `node --test tests/svg-renderer.test.js`

Expected: FAIL because only the first transition is projected and no vertical connector classes exist.

- [ ] **Step 3: Build signal-row and transition-position maps**

While computing rows, retain `signalYById`. Resolve every referenced transition to `{ x: markerX.get(transition.markerId), y: signalYById.get(transition.signalId) }`. The first member supplies the horizontal endpoint x; validation guarantees all members in that endpoint share it.

- [ ] **Step 4: Render connectors and connection marks in the timing layer**

For each start and end member, render:

```js
`<line class="timing-connector ${endpoint}" data-transition-id="${escapeXml(transition.id)}" x1="${x}" x2="${x}" y1="${timingY}" y2="${signalY}"/>`
`<circle class="timing-connection-mark ${endpoint}" data-transition-id="${escapeXml(transition.id)}" cx="${x}" cy="${signalY}" r="4"/>`
```

Place connectors, target marks, horizontal drag target, arrow, label, and endpoint handles inside the timing relation group. Add pointer-events rules so only the horizontal drag target, label/arrow, and endpoint handles initiate drag.

Remove the one-decimal rounding around rendered `timingY`; derive it directly from the normalized position.

- [ ] **Step 5: Verify SVG projection**

Run: `node --test tests/svg-renderer.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit connector rendering**

```bash
git add src/render/svg-renderer.js tests/svg-renderer.test.js
git commit -m "feat: connect timing endpoints to synchronous transitions"
```

### Task 6: Smooth vertical drag and grouped endpoint rebind

**Files:**
- Modify: `src/ui/controller.js`
- Modify: `src/domain/operations.js`
- Modify: `tests/controller.test.js`
- Modify: `tests/operations.test.js`

**Interfaces:**
- Produces: `pointerSvgY(svg, event) -> number`
- Updates: `timingPositionFromPointer(svg, event, { grabOffsetY = 0 }) -> number`
- Consumes: `rebindTimingEndpoint(document, { parameterId, endpoint, transitionId })`

- [ ] **Step 1: Write failing grab-offset tests**

```js
function timingSvgFixture() {
  return {
    dataset: { timingTopY: '64', timingBottomY: '144' },
    getBoundingClientRect: () => ({ top: 100, height: 400 }),
    viewBox: { baseVal: { height: 320 } }
  };
}

test('timing drag preserves the pointer grab offset', () => {
  const svg = timingSvgFixture();
  const pointerY = pointerSvgY(svg, { clientY: 250 });
  const grabOffsetY = pointerY - 84;
  assert.equal(timingPositionFromPointer(svg, { clientY: 300 }, { grabOffsetY }), 0.75);
});
```

Add a test that position values are stored to six decimal places and a controller operation test that an endpoint drop calls grouped rebind semantics rather than updating a singular field.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/controller.test.js tests/operations.test.js`

Expected: FAIL because the current math centers the timing arrow on the pointer and endpoint drop writes a singular ID.

- [ ] **Step 3: Separate SVG coordinate conversion from normalization**

```js
export function pointerSvgY(svg, event) {
  const rect = svg.getBoundingClientRect();
  return ((event.clientY - rect.top) / rect.height) * svg.viewBox.baseVal.height;
}

export function timingPositionFromPointer(svg, event, { grabOffsetY = 0 } = {}) {
  const top = Number(svg.dataset.timingTopY);
  const bottom = Number(svg.dataset.timingBottomY);
  const y = pointerSvgY(svg, event) - grabOffsetY;
  return Math.max(0, Math.min(1, (y - top) / (bottom - top)));
}
```

Round only when saving in `setTimingParameterPosition`:

```js
next.presentation.timingParameterPositions[parameterId] = Math.round(normalizedPosition * 1_000_000) / 1_000_000;
```

- [ ] **Step 4: Preserve grab offset throughout one pointer gesture**

On timing pointer-down, save `originalY`, `grabOffsetY: pointerSvgY(svg, event) - originalY`, and `position` equal to the stored position. On pointer-move, calculate the offset-aware position, update `state.drag.position`, and preview one group transform. On pointer-up, commit `state.drag.position`; do not recalculate from the pointer event. Pointer-cancel clears the transform by re-rendering without applying an operation.

- [ ] **Step 5: Route endpoint drops through grouped rebind**

For timing endpoint drops call `rebindTimingEndpoint`. Keep the existing `updatePhase` singular behavior. A same-slot drop preserves the selected subset; a different-slot drop resets it to the dropped transition. Error notices come through the existing `applyOperation` catch path.

- [ ] **Step 6: Verify smooth drag and rebind behavior**

Run: `node --test tests/controller.test.js tests/operations.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit pointer interaction changes**

```bash
git add src/ui/controller.js src/domain/operations.js tests/controller.test.js tests/operations.test.js
git commit -m "fix: make timing overlay drag smooth"
```

### Task 7: Documentation, integration, and deployment regression gate

**Files:**
- Modify: `docs/spec.md`
- Modify: `README.md`
- Create: `tests/module-graph.test.js`
- Test: `tests/*.test.js`

**Interfaces:**
- Consumes: schema `1.1`, checkbox editing, connector SVG, and pointer behavior from Tasks 1–6
- Produces: one documented, deployable feature-branch snapshot

- [ ] **Step 1: Update the normative schema example and behavior text**

In `docs/spec.md`, replace timing singular fields with plural arrays, document same-slot membership, vertical connectors, checkbox subset editing, legacy `1.0` migration, and safe transition deletion. In `README.md`, update the smoke-test sequence to include two transitions at one endpoint and free vertical dragging.

- [ ] **Step 2: Run static and full automated verification**

Run:

```bash
node --check src/domain/migrate.js
node --check src/domain/timing-endpoints.js
node --check src/domain/operations.js
node --check src/domain/validate.js
node --check src/render/svg-renderer.js
node --check src/ui/controller.js
node --test
git diff --check
```

Expected: every command exits `0` and all tests pass.

- [ ] **Step 3: Add and run the browser module-graph regression**

Create `tests/module-graph.test.js` to recursively read static relative imports reachable from `src/main.js`, resolve each path with `path.resolve(path.dirname(importer), specifier)`, assert `existsSync(resolvedPath)`, and visit each JavaScript dependency once. Include an assertion that the reachable set contains both `src/domain/migrate.js` and `src/domain/timing-endpoints.js`.

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every local browser module reachable from main exists', () => {
  const visited = new Set();
  function visit(file) {
    const absolute = path.resolve(file);
    if (visited.has(absolute)) return;
    assert.equal(existsSync(absolute), true, `Missing browser module: ${path.relative(root, absolute)}`);
    visited.add(absolute);
    const source = readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'\"]+?\s+from\s+)?['\"](\.[^'\"]+)['\"]/g)) {
      visit(path.resolve(path.dirname(absolute), match[1]));
    }
  }
  visit(path.join(root, 'src/main.js'));
  assert.equal(visited.has(path.join(root, 'src/domain/migrate.js')), true);
  assert.equal(visited.has(path.join(root, 'src/domain/timing-endpoints.js')), true);
});
```

Run: `node --test tests/module-graph.test.js`

Expected: PASS with every reachable local module present.

- [ ] **Step 4: Run the browser smoke test**

Start the local server with `npm run dev`, then verify:

1. Add `WE#` and `CE#` transitions at the same start order slot and a later end transition.
2. Create a timing parameter and select both start transitions in the Inspector.
3. Confirm two vertical start connectors and one end connector.
4. Grab the arrow, label, and wide hit target at different offsets; none jumps on initial movement.
5. Rebind an endpoint to a different valid slot and confirm its subset resets to the dropped transition.
6. Export JSON and confirm schema `1.1` with plural endpoint arrays only.
7. Import a schema `1.0` singleton document and confirm it opens in editor mode.

- [ ] **Step 5: Commit documentation and the module-graph gate**

```bash
git add docs/spec.md README.md tests/module-graph.test.js
git commit -m "docs: describe grouped timing endpoints"
```

- [ ] **Step 6: Record the verified delivery state**

Run: `git status --short --branch && git log -7 --oneline`

Expected: clean `feat/structured-waveform-editor-mvp` worktree with the Task 1–7 commits at its tip. Do not push or deploy until the user explicitly authorizes the exact GitHub repository, branch, and existing website destination.
