# React and Ant Design UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live imperative editor UI with React and Ant Design while preserving every existing waveform behavior.

**Architecture:** Keep the domain model and SVG renderer framework-neutral. Bundle a React application that renders Ant Design panels and owns UI state; connect it to existing semantic operations, storage, import/export, and authenticated Worker delivery.

**Tech Stack:** React 18, ReactDOM, Ant Design 5, Ant Design Icons, esbuild, native Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-12-react-antd-ui-migration-design.md`

## Global Constraints

- The waveform document remains the only semantic source of truth.
- Preserve the existing Google session worker, schema, browser-local history key, SVG/PNG/JSON output, and example document behavior.
- Do not add theme finder assistant or new waveform semantics.
- Tests must exercise public UI behavior and the final authenticated asset graph.

---

### Task 1: Create the React build and application shell

**Files:**
- Modify: `package.json`, `index.html`, `scripts/build.mjs`, `tests/build.test.js`
- Create: `src/react/main.jsx`, `src/react/App.jsx`, `src/react/app.css`

**Interfaces:**
- Consumes: `initializeAccountActions` replacement behavior and existing `createProductionWorker` asset map.
- Produces: `/assets/app.js` and `/assets/app.css` served after authentication.

- [ ] **Step 1: Write the failing bundle contract test**

Assert that built HTML references `/assets/app.js`, and that an authenticated Worker request receives both `/assets/app.js` and `/assets/app.css`.

- [ ] **Step 2: Run the build test to verify it fails**

Run: `node --test tests/build.test.js`
Expected: FAIL because the existing raw module graph has no bundled React asset.

- [ ] **Step 3: Add React, Ant Design, and esbuild plus the minimal React root**

Create an `App` component rendered by `createRoot`, wrap it in Ant Design `ConfigProvider`, and retain the signed-in account/logout contract.

- [ ] **Step 4: Bundle the root and CSS into the Worker asset map**

Use esbuild in `scripts/build.mjs` to emit browser assets, add them to the generated `assets.js` map, and use the generated HTML entry point.

- [ ] **Step 5: Run the focused build test**

Run: `node --test tests/build.test.js`
Expected: PASS.

### Task 2: Migrate document state and non-canvas UI

**Files:**
- Create: `src/react/use-waveform-editor.js`, `src/react/AuthoringPanel.jsx`, `src/react/InspectorPanel.jsx`, `src/react/HistoryPanel.jsx`, `src/react/RepairPanel.jsx`
- Modify: `tests/controller.test.js`

**Interfaces:**
- Consumes: operations from `src/domain/operations.js`, history functions from `src/ui/document-history.js`, and import/export functions.
- Produces: an editor state hook with `applyOperation`, `openHistory`, `openExample`, `importDocument`, `exportJson`, and `exportPng` actions.

- [ ] **Step 1: Write a failing mounted-UI behavior test**

Assert that the React editor exposes Ant Design-visible authoring, history, example, validation, and export controls with a document fixture.

- [ ] **Step 2: Run it to verify failure**

Run: `node --test tests/react-editor.test.js`
Expected: FAIL because the React editor state hook and panels do not yet exist.

- [ ] **Step 3: Implement the state hook and Ant Design panels**

Model all mutations as calls to existing domain operations. Preserve repair mode, invalid-export policy, active history updates, fresh example copies, metadata, collapsed signal controls, and exact delete confirmations.

- [ ] **Step 4: Run the focused React UI test**

Run: `node --test tests/react-editor.test.js`
Expected: PASS.

### Task 3: Migrate the waveform canvas interactions

**Files:**
- Create: `src/react/WaveformCanvas.jsx`, `src/react/canvas-interactions.js`
- Modify: `src/ui/controller.js`, `tests/controller.test.js`, `tests/react-editor.test.js`

**Interfaces:**
- Consumes: `renderSvg`, timeline layout helpers, existing relation endpoint semantics, and the editor-state hook.
- Produces: React-owned SVG rendering with pointer callbacks that preserve drag, pan, resize, and relationship actions.

- [ ] **Step 1: Write a failing public canvas interaction test**

Assert that a rendered React canvas binds a transition drag and a passive background pan without changing the semantic document until the appropriate release.

- [ ] **Step 2: Run it to verify failure**

Run: `node --test tests/react-editor.test.js`
Expected: FAIL because React canvas bindings do not exist.

- [ ] **Step 3: Implement React canvas bindings**

Move reusable pointer helpers out of the legacy controller, attach them through refs, preserve signal rail positioning, relationship drag feedback, and full SVG PNG export.

- [ ] **Step 4: Run focused canvas and controller tests**

Run: `node --test tests/controller.test.js tests/react-editor.test.js`
Expected: PASS.

### Task 4: Remove the active legacy renderer path and complete verification

**Files:**
- Modify: `src/main.js`, `src/ui/account.js`, `src/ui/styles.css`, `README.md`, `tests/account.test.js`, `tests/module-graph.test.js`

**Interfaces:**
- Consumes: React application root and authenticated Worker.
- Produces: the React + Ant Design application as the only live editor UI.

- [ ] **Step 1: Write failing application-entry assertions**

Assert that the production entry mounts the React application and no live page imports the legacy imperative editor initializer.

- [ ] **Step 2: Run it to verify failure**

Run: `node --test tests/module-graph.test.js tests/account.test.js`
Expected: FAIL because the legacy entry remains active.

- [ ] **Step 3: Switch the production entry, update styles and documentation**

Mount the React application after the existing account check, preserve account tests through a framework-neutral session function, and remove inactive styles from the live stylesheet.

- [ ] **Step 4: Run full verification**

Run: `npm test && npm run build && git diff --check`
Expected: PASS with the authenticated React bundle and all existing domain tests green.
