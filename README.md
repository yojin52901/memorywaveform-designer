# Memory Waveform Designer

A static, structured editor for memory timing waveforms. The waveform document—not canvas pixels—is the source of truth. SVG, PNG, and export JSON are projections of that one semantic model.

## Access and privacy

The deployed editor requires Google sign-in with a verified `@gmail.com` address. Anyone may open the sign-in page, but the waveform editor and its browser modules are delivered only after the worker verifies a Google identity and creates a secure session. The toolbar shows the signed-in address and provides a **登出** button to end that browser session.

Waveform documents, history, and exports remain in the current browser's `localStorage`; signing in does not upload, share, or migrate them. The integration requests identity only: it does not use Google Drive or Gmail scopes, and no OAuth secret is stored in this repository or in browser storage.

## Verify locally

```bash
npm test
```

The deployed authentication boundary is a Sites worker and needs its runtime environment (`GOOGLE_CLIENT_ID` and a secret session-signing key). The Node test suite covers its token, session, route, and editor-account behavior without live Google credentials.

## Core interactions

The **Example document** button above document history is available to every signed-in user. It opens a fresh local copy of the bundled ENVM power-on/write/power-off example, with six signals, five timing parameters (including a shared start endpoint), three phases, and UNKNOWN data states. Editing or deleting a copy does not change the built-in example. Existing documents stay in history. The example is illustrative and does not specify device timing requirements.

1. Add a signal and choose its initial `HIGH`, `LOW`, `UNKNOWN`, or `UNSPECIFIED` state.
2. Add state transitions at integer order slots. A shared slot is a simultaneous marker.
3. Create timing parameters or phases by selecting their two transition endpoints. A timing endpoint can include a non-empty checkbox subset of all synchronous transitions in one order slot; timing rules accept `>= 20 ns`, `<= 40 ns`, `= 25 ns`, and `20 ns..40 ns`.
4. Drag a marker column to move its complete synchronous group; drag a transition point to move its complete timing-endpoint connection group while unrelated transitions remain in place. Crossing a timing or phase counterpart automatically reorients that relation left-to-right. A timing parameter draws one vertical connector per selected endpoint transition. Drag its arrow, label, or wide hit target freely up and down without changing endpoint semantics; drag a timing/phase endpoint onto a transition to rebind it.
   To adjust visual spacing, drag the resize handle above a timeline gap. Each handle changes only that gap's displayed width; it does not move the order slot or change timing semantics.
   When the waveform exceeds the visible canvas, drag its background or signal line horizontally, or use the horizontal scrollbar. Signal names stay fixed in the left column. Edits retain the current horizontal position, and PNG exports include all signal names and the full waveform, including content outside the viewport.
   Phase arrows and labels can also move vertically within the signal overlay interval; their vertical connectors remain attached to the corresponding transitions.
5. Use the inspector to update signal metadata, order rows, add annotations, or safely delete transitions/signals with their dependencies.
6. Export JSON only after validation passes. An invalid in-progress design can still export a visibly watermarked `DRAFT / INVALID` PNG. Invalid imported JSON stays in non-rendering repair mode until it is corrected.

## Verification

Run the model, timing-rule, validation, SVG, and JSON import/export checks with:

```bash
node --test
```

Browser smoke test: build `WE#` and `CE#` with simultaneous falling transitions at one start slot and a later end transition; create `tWP >= 20 ns`, select both start transitions in the Inspector, and confirm two vertical start connectors plus one end connector. Move either selected start transition to a new valid slot and confirm both selected transitions move together, while an unrelated synchronous transition stays put. Move the group across the opposite endpoint and confirm the timing direction updates left-to-right. Drag the timing arrow, label, and wide hit target at different offsets to confirm smooth free vertical movement; rebind an endpoint to another valid slot and confirm its subset resets. Export JSON and confirm schema `1.1` uses only plural timing endpoint arrays, then import a schema `1.0` singleton document and confirm editor mode opens.

## MVP boundary

The first version deliberately excludes legacy image/PDF recognition, physical-time scaling, analog curves, buses, code generation, services, and collaboration. See [docs/spec.md](docs/spec.md) for the full Chinese product contract.
