# History and Drag Surface Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two release-blocking residuals by preserving malformed history snapshots in repair mode and proving every renderer-produced timing drag surface reaches the production pointer lifecycle.

**Architecture:** History storage owns only the history envelope and cloned raw snapshots; migration and validation happen when a snapshot is activated through `loadDocumentJson`. Repair rendering treats every untrusted semantic collection as unknown input and only iterates arrays. Timing interaction tests start from `renderSvg(document)` output, derive the three intended surface nodes from that output, and dispatch through the same `bindCanvasPointerEvents` seam used by `createEditor`.

**Tech Stack:** Browser-native ES modules, Node.js `node:test`, SVG string renderer, dependency-free local DOM/event harness.

**Spec:** `docs/superpowers/specs/2026-08-31-multi-transition-timing-endpoints-design.md`

## Global Constraints

- Do not change schema `1.1`, timing endpoint semantics, phase singleton endpoints, connector geometry, or drag position math.
- Do not discard a JSON-valid saved-history envelope because one snapshot is semantically malformed or uses an unsupported schema version.
- Malformed snapshots remain selectable and enter repair mode with their raw JSON available.
- Repair mode must not call `.map()` or other array-only methods on unvalidated collection values.
- The three supported vertical drag surfaces remain `.relation-drag-target`, `.relation-arrow`, and the timing relation `<text>` label.
- Tests must exercise `bindCanvasPointerEvents`, the production seam called by `createEditor`, and must derive surface presence from `renderSvg` output.
- No new runtime or test dependencies, no network access, no push, no deployment, and no unrelated refactoring.

---

### Task 1: Preserve malformed history and render repair mode safely

**Files:**
- Modify: `src/ui/document-history.js`
- Modify: `src/ui/controller.js`
- Test: `tests/document-history.test.js`
- Test: `tests/controller.test.js`

**Interfaces:**
- Consumes: `loadDocumentJson(text)` returning `{ document, validation, mode, canRender }`.
- Produces: `loadHistory(storage, fallbackEntry)` that preserves every structurally valid entry snapshot without eager semantic migration; `selectHistoryEntry(history, entryId)` remains the single activation path returning validated editor/repair state.

- [ ] **Step 1: Add the failing history-envelope test**

  Add a case whose saved envelope is valid but whose active schema `1.0` snapshot contains `semantic.timingParameters: {}`. Assert `loadHistory` retains the original entry and active ID instead of returning fallback history, then assert `selectHistoryEntry` returns `mode: 'repair'` and repair text containing the malformed object.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `node --test tests/document-history.test.js`

  Expected: failure showing the malformed entry was replaced by the fallback because eager migration threw.

- [ ] **Step 3: Remove eager snapshot migration from history-envelope loading**

  Keep JSON parsing and envelope checks in `loadHistory`, but clone raw entry snapshots without invoking `migrateDocument`. Remove the now-unused migration import. Continue to migrate and validate only through `selectHistoryEntry` → `loadDocumentJson`.

- [ ] **Step 4: Run the history tests and confirm GREEN**

  Run: `node --test tests/document-history.test.js`

  Expected: all history tests pass, including valid legacy migration on selection rather than envelope read.

- [ ] **Step 5: Add the failing repair-render test**

  Through `createEditor`, activate a saved malformed snapshot containing wrong-typed collections such as `signals: {}`, `stateSegments: null`, `transitions: "broken"`, `timingParameters: {}`, `phases: 1`, and `annotations: false`. Assert startup and later history selection do not throw, remain in repair mode, keep the history disclosure, and expose the malformed JSON in the repair editor.

- [ ] **Step 6: Run the controller test and confirm RED**

  Run: `node --test tests/controller.test.js`

  Expected: failure from repair inspector calling `.map()` on a non-array collection.

- [ ] **Step 7: Make repair rendering collection-safe**

  Introduce a narrow helper such as `arrayItems(value) { return Array.isArray(value) ? value : []; }` and use it for every unvalidated semantic collection enumerated by repair-mode inspector rendering. Do not coerce or repair the document itself; the raw malformed values must remain visible in `repairText` and selected-property output.

- [ ] **Step 8: Verify and commit Task 1**

  Run:

  ```sh
  node --test tests/document-history.test.js tests/controller.test.js
  node --check src/ui/document-history.js
  node --check src/ui/controller.js
  git diff --check
  ```

  Commit: `fix: preserve malformed history for repair`

---

### Task 2: Couple timing drag lifecycle tests to renderer surfaces

**Files:**
- Modify: `tests/controller.test.js`
- Inspect without production changes unless a real defect is proven: `src/render/svg-renderer.js`
- Inspect without semantic changes: `src/ui/controller.js`

**Interfaces:**
- Consumes: `renderSvg(documentModel)` and `bindCanvasPointerEvents(svg, callbacks)`.
- Produces: integration tests that fail if the renderer omits or renames any intended timing drag surface, while dispatching each renderer-derived surface through the production event handlers.

- [ ] **Step 1: Replace the synthetic three-surface loop with a renderer-derived failing test**

  Import `renderSvg`. Render `waveformWithTiming()`, isolate the timing `<g data-relation-kind="timing">`, and derive exactly one node for each independent contract selector: `.relation-drag-target`, `.relation-arrow`, and the timing-group `<text>`. Build the dependency-free fake node ancestry from the matched rendered markup rather than passing arbitrary `className`/`tagName` options. Assert all three nodes are found before dispatching them through `bindCanvasPointerEvents`.

- [ ] **Step 2: Prove the new test is load-bearing**

  Temporarily remove or rename one surface in a local uncommitted renderer change, run `node --test tests/controller.test.js`, and observe the test fail because the renderer-derived surface is missing. Restore the renderer exactly before continuing. Record this RED evidence in the task report; do not commit the temporary production mutation.

- [ ] **Step 3: Complete lifecycle assertions for every renderer-derived node**

  For each of the three nodes, dispatch registered `pointerdown`, `pointermove`, and `pointerup` callbacks. Assert pointer capture, preview `transform`, no semantic mutation during move, commit of the final preview position, and one render on commit. Retain the separate `pointercancel` no-mutation/restore test and relation-endpoint priority test, with their targets also modeled as descendants of the actual timing group contract.

- [ ] **Step 4: Run focused and full verification**

  Run:

  ```sh
  node --test tests/controller.test.js tests/svg-renderer.test.js
  node --test
  node --check tests/controller.test.js
  git diff --check
  ```

  Expected: all tests pass; the full suite has no regressions; no renderer production change remains unless the RED loop exposed a real product defect.

- [ ] **Step 5: Commit Task 2**

  Commit: `test: bind timing drag coverage to rendered surfaces`
