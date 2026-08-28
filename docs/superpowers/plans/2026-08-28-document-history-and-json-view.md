# Document History and JSON View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make timing DSL text an unrestricted note, persist the latest state of multiple local waveform documents, and provide collapsed authoring tools plus a valid-document waveform/JSON switcher.

**Architecture:** Waveform JSON remains the semantic source of truth. A new browser-only history adapter stores editor snapshots outside exported JSON, while the controller owns the active history entry and selected middle-pane view. Validation is reduced to waveform structure; timing note content is never parsed or used to block rendering/export.

**Tech Stack:** Browser ES modules, DOM templates, `localStorage`, Node's built-in `node:test` and `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-28-document-history-and-json-view-design.md`

## Global Constraints

- Keep history browser-local under `memorywaveform-designer.history.v1`; never add it to exported waveform JSON.
- A timing parameter's `requirementText` is a free-form optional note; no text or legacy parsed metadata can make a document invalid.
- Only structural errors keep JSON export disabled and suppress the derived JSON view.
- Keep repair-mode raw JSON behaviour; repair mode never renders waveform or derived JSON.
- History stores one latest snapshot per document, not a per-edit version stream.
- Every history and authoring disclosure starts closed.

---

### Task 1: Make timing DSL text an unrestricted note

**Files:**
- Modify: `src/domain/operations.js` — `addTimingParameter`, `updateTimingParameter`
- Modify: `src/domain/validate.js` — `validateEndpointRelations`
- Modify: `src/ui/controller.js` — timing authoring and inspector markup
- Modify: `docs/spec.md` — timing-note and validation wording
- Test: `tests/validate.test.js`
- Test: `tests/import-export.test.js`

**Interfaces:**
- Consumes: `addTimingParameter(document, values)` and `updateTimingParameter(document, parameterId, updates)`.
- Produces: newly created or edited timing parameters with `parsedRequirement: null` and `validationStatus: 'note'`.
- Produces: `validateDocument(document)` does not inspect `requirementText`, `parsedRequirement`, or `validationStatus`.

- [ ] **Step 1: Write the failing tests**

```js
test('timing requirement text is an unrestricted note', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  parameter.requirementText = 'tWP ≥ 20 ns; characterize at hot corner';
  parameter.parsedRequirement = { stale: true };
  parameter.validationStatus = 'unparsed';

  assert.deepEqual(validateDocument(document), { valid: true, errors: [], warnings: [] });
  assert.doesNotThrow(() => exportDocumentJson(document));
});

test('editing a timing note clears obsolete parsed metadata', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  const updated = updateTimingParameter(document, parameter.id, {
    requirementText: 'verify against datasheet rev C'
  });

  assert.equal(updated.semantic.timingParameters[0].parsedRequirement, null);
  assert.equal(updated.semantic.timingParameters[0].validationStatus, 'note');
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node --test tests/validate.test.js tests/import-export.test.js`

Expected: FAIL because the legacy parser still rejects or warns about free-form text and operation metadata is not `note`.

- [ ] **Step 3: Implement the smallest note-only behaviour**

```js
function timingNoteMetadata(requirementText) {
  return {
    requirementText: requirementText ?? '',
    parsedRequirement: null,
    validationStatus: 'note'
  };
}

// validateEndpointRelations keeps endpoint-reference checks only.
// Remove every parseRequirement call and DSL-specific error/warning.
```

Use this metadata in both timing parameter operations. Rename both form labels to `Requirement note (optional)` and remove parser-format/status copy. Update `docs/spec.md` to declare downstream rule extraction out of MVP scope.

- [ ] **Step 4: Run focused tests and confirm they pass**

Run: `node --test tests/validate.test.js tests/import-export.test.js tests/controller.test.js`

Expected: PASS; arbitrary note text exports and structural endpoint failures remain invalid.

- [ ] **Step 5: Commit**

```bash
git add src/domain/operations.js src/domain/validate.js src/ui/controller.js docs/spec.md tests/validate.test.js tests/import-export.test.js tests/controller.test.js
git commit -m "feat: treat timing DSL as optional note"
```

### Task 2: Add a focused browser document-history adapter

**Files:**
- Create: `src/ui/document-history.js`
- Test: `tests/document-history.test.js`

**Interfaces:**
- Consumes: a storage object with `getItem(key)` and `setItem(key, value)`.
- Produces: `HISTORY_STORAGE_KEY`, `createHistoryEntry(snapshot, options)`, `createHistoryState(entry)`, `loadHistory(storage, fallbackEntry)`, `replaceActiveHistoryEntry(history, snapshot, now)`, `appendHistoryEntry(history, entry)`, `selectHistoryEntry(history, entryId)`, and `saveHistory(storage, history)`.
- Return values: `loadHistory` returns `{ history, notice }`; `saveHistory` returns `{ saved, notice }`; storage failures never throw.

- [ ] **Step 1: Write the failing adapter tests**

```js
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('reloads the latest snapshot of the active document', () => {
  const storage = memoryStorage();
  const entry = createHistoryEntry(
    { document: createDocument({ title: 'A' }), mode: 'editor', repairText: '' },
    { id: 'hist_a', now: '2026-08-28T00:00:00.000Z' }
  );
  const updated = replaceActiveHistoryEntry(createHistoryState(entry), {
    document: createDocument({ title: 'Updated A' }), mode: 'editor', repairText: ''
  }, '2026-08-28T01:00:00.000Z');

  assert.equal(saveHistory(storage, updated).saved, true);
  assert.equal(loadHistory(storage, entry).history.entries[0].document.metadata.title, 'Updated A');
});

test('returns a notice instead of throwing when storage is unavailable', () => {
  const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const entry = createHistoryEntry(
    { document: createDocument(), mode: 'editor', repairText: '' },
    { id: 'hist_a', now: '2026-08-28T00:00:00.000Z' }
  );

  assert.match(loadHistory(storage, entry).notice, /history/i);
  assert.equal(saveHistory(storage, createHistoryState(entry)).saved, false);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/document-history.test.js`

Expected: FAIL with module-not-found for `src/ui/document-history.js`.

- [ ] **Step 3: Implement the adapter**

```js
export const HISTORY_STORAGE_KEY = 'memorywaveform-designer.history.v1';

export function createHistoryEntry({ document, mode, repairText }, { id, now }) {
  return {
    id,
    title: document?.metadata?.title ?? 'Untitled waveform',
    updatedAt: now,
    mode,
    document: cloneSnapshot(document),
    repairText
  };
}

export function selectHistoryEntry(history, entryId) {
  return history.entries.some((entry) => entry.id === entryId)
    ? { ...history, activeHistoryId: entryId }
    : history;
}
```

Deep-clone stored document snapshots. At load time discard malformed entries while retaining valid ones; if none remain, use the fallback entry. Catch storage read/write errors and return a notice without touching in-memory history.

- [ ] **Step 4: Run the adapter tests and confirm they pass**

Run: `node --test tests/document-history.test.js`

Expected: PASS; latest snapshot persistence, selection, malformed storage recovery, and storage failures are deterministic.

- [ ] **Step 5: Commit**

```bash
git add src/ui/document-history.js tests/document-history.test.js
git commit -m "feat: persist local waveform document history"
```

### Task 3: Integrate collapsed history and authoring disclosures

**Files:**
- Modify: `src/ui/controller.js` — `createEditor`, palette rendering, document-changing handlers
- Modify: `src/ui/styles.css` — disclosure, history-list, and active-entry styles
- Test: `tests/controller.test.js`

**Interfaces:**
- Consumes: Task 2 history adapter and browser `window.localStorage`.
- Produces: controller state fields `history`, `activeHistoryId`, and `view: 'waveform' | 'json'`.
- Produces: exported `renderPaletteMarkup({ documentModel, history, activeHistoryId })` for string-level rendering tests.
- Produces: `persistActiveSnapshot()` and `createAndActivateHistoryEntry(snapshot)` inside the controller.

- [ ] **Step 1: Write the failing palette markup test**

```js
test('authoring palette starts with closed history and tool disclosures', () => {
  const markup = renderPaletteMarkup({
    documentModel: createDocument({ title: 'Program' }),
    history: {
      activeHistoryId: 'hist_a',
      entries: [{ id: 'hist_a', title: 'Program', updatedAt: '2026-08-28T00:00:00.000Z', mode: 'editor' }]
    },
    activeHistoryId: 'hist_a'
  });

  assert.match(markup, /<details class="history-disclosure">/);
  assert.doesNotMatch(markup, /<details[^>]+open/);
  assert.match(markup, /data-history-entry="hist_a"/);
  assert.equal((markup.match(/class="tool-disclosure"/g) ?? []).length, 5);
});
```

- [ ] **Step 2: Run the controller tests and confirm the palette test fails**

Run: `node --test tests/controller.test.js`

Expected: FAIL because palette forms are permanently open and no history list exists.

- [ ] **Step 3: Implement palette/history integration**

```js
export function renderPaletteMarkup({ documentModel, history, activeHistoryId }) {
  const historyItems = history.entries.map((entry) =>
    `<button type="button" data-history-entry="${entry.id}" aria-current="${entry.id === activeHistoryId}">${entry.title}</button>`
  ).join('');
  return `<details class="history-disclosure"><summary>Document history (${history.entries.length})</summary>${historyItems}</details>
    <details class="tool-disclosure"><summary>Add signal</summary><form data-form="signal">${signalFields(documentModel)}</form></details>`;
}

function persistActiveSnapshot() {
  state.history = replaceActiveHistoryEntry(state.history, activeSnapshot(), new Date().toISOString());
  const outcome = saveHistory(window.localStorage, state.history);
  if (outcome.notice) setNotice(outcome.notice);
}
```

Initialise history from `loadHistory(window.localStorage, initialEntry)`. Call `persistActiveSnapshot()` after every successful authoring, metadata, repair, and document state update. New document/import must append and activate a new entry, reset selected transition and `view` to `'waveform'`, then persist. Clicking `[data-history-entry]` snapshots the active entry first, restores target `document`, `mode`, and `repairText`, clears selection, and rerenders.

- [ ] **Step 4: Run controller and history tests**

Run: `node --test tests/controller.test.js tests/document-history.test.js`

Expected: PASS; all six sidebar disclosures are closed by default and history state never enters exported waveform JSON.

- [ ] **Step 5: Commit**

```bash
git add src/ui/controller.js src/ui/styles.css tests/controller.test.js
git commit -m "feat: add collapsed local document history"
```

### Task 4: Render current JSON as a derived valid-document view

**Files:**
- Modify: `src/ui/controller.js` — middle-pane markup and view-toggle event handler
- Modify: `src/ui/styles.css` — view switcher and read-only JSON surface
- Test: `tests/controller.test.js`
- Test: `tests/import-export.test.js`

**Interfaces:**
- Consumes: `exportDocumentJson(document)` only after `validateDocument(document).valid === true`.
- Produces: exported `renderEditorMarkup(documentModel, { mode, validation, view })`.
- Produces: `[data-editor-view]` controls that set `state.view` to `'waveform'` or `'json'`; invalid documents force waveform.

- [ ] **Step 1: Write the failing view tests**

```js
test('a valid document defaults to waveform and can show derived JSON', () => {
  const document = validWaveformForController();
  const validation = validateDocument(document);

  const waveform = renderEditorMarkup(document, { mode: 'editor', validation, view: 'waveform' });
  const json = renderEditorMarkup(document, { mode: 'editor', validation, view: 'json' });

  assert.match(waveform, /id="waveform-canvas"/);
  assert.match(waveform, /data-editor-view="json"/);
  assert.match(json, /id="document-json-view"/);
  assert.match(json, /"schemaVersion": "1\.0"/);
  assert.doesNotMatch(json, /<svg/);
});

test('a structural draft keeps waveform but cannot open derived JSON', () => {
  const document = createDocument({ title: 'Draft' });
  document.metadata.title = '';
  const markup = renderEditorMarkup(document, {
    mode: 'editor', validation: validateDocument(document), view: 'json'
  });

  assert.match(markup, /id="waveform-canvas"/);
  assert.doesNotMatch(markup, /data-editor-view="json"/);
});
```

- [ ] **Step 2: Run controller tests and confirm view tests fail**

Run: `node --test tests/controller.test.js`

Expected: FAIL because `renderEditorMarkup` and JSON view controls do not yet exist.

- [ ] **Step 3: Extract middle-pane markup and wire the switcher**

```js
export function renderEditorMarkup(documentModel, { mode, validation, view }) {
  if (mode === 'repair') return renderRepairMarkup();
  const valid = validation.valid;
  const selectedView = valid && view === 'json' ? 'json' : 'waveform';
  const switcher = valid ? `<div class="view-switcher" role="group" aria-label="Editor view">
    <button type="button" data-editor-view="waveform" aria-pressed="${selectedView === 'waveform'}">Waveform</button>
    <button type="button" data-editor-view="json" aria-pressed="${selectedView === 'json'}">JSON</button>
  </div>` : '';

  return selectedView === 'json'
    ? `${switcher}<pre id="document-json-view">${escapeHtml(exportDocumentJson(documentModel))}</pre>`
    : `${switcher}<div id="waveform-canvas">${renderSvg(documentModel, { draft: !valid })}</div>`;
}
```

Bind clicks on `[data-editor-view]` in the editor container. Bind canvas drag events only when waveform markup exists. Leave repair mode's raw JSON textarea unchanged. Add CSS for visible selected state and a scrollable monospace JSON surface.

- [ ] **Step 4: Run full verification**

Run: `npm test && git diff --check`

Expected: PASS with every existing and new test green, and no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/controller.js src/ui/styles.css tests/controller.test.js tests/import-export.test.js docs/spec.md
git commit -m "feat: add derived json view for valid waveforms"
```

## Plan Self-Review

- Spec coverage: Task 1 covers note-only DSL and structural validation; Task 2 covers browser-local latest-snapshot history and storage failures; Task 3 covers collapsed sidebar UI and restoration; Task 4 covers valid waveform/JSON switching and repair-mode boundaries.
- Placeholder scan: Every new adapter and controller seam is named and exercised by a concrete test before its implementation.
- Type consistency: Task 2 defines the `history`, `activeHistoryId`, `entries`, `mode`, `document`, `repairText`, and `notice` names consumed in Task 3. Task 3 defines the `view` state consumed in Task 4.
