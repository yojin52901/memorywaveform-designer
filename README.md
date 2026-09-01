# Memory Waveform Designer

A static, structured editor for memory timing waveforms. The waveform document—not canvas pixels—is the source of truth. SVG, PNG, and export JSON are projections of that one semantic model.

## Run locally

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173). No package installation or server-side dependency is required.

## Core interactions

1. Add a signal and choose its initial `HIGH`, `LOW`, `UNKNOWN`, or `UNSPECIFIED` state.
2. Add state transitions at integer order slots. A shared slot is a simultaneous marker.
3. Create timing parameters or phases by selecting their two transition endpoints. A timing endpoint can include a non-empty checkbox subset of all synchronous transitions in one order slot; timing rules accept `>= 20 ns`, `<= 40 ns`, `= 25 ns`, and `20 ns..40 ns`.
4. Drag a marker column to move its complete synchronous group; drag a transition point to split it into another marker. A timing parameter draws one vertical connector per selected endpoint transition. Drag its arrow, label, or wide hit target freely up and down without changing endpoint semantics; drag a timing/phase endpoint onto a transition to rebind it.
5. Use the inspector to update signal metadata, order rows, add annotations, or safely delete transitions/signals with their dependencies.
6. Export JSON only after validation passes. An invalid in-progress design can still export a visibly watermarked `DRAFT / INVALID` PNG. Invalid imported JSON stays in non-rendering repair mode until it is corrected.

## Verification

Run the model, timing-rule, validation, SVG, and JSON import/export checks with:

```bash
node --test
```

Browser smoke test: build `WE#` and `CE#` with simultaneous falling transitions at one start slot and a later end transition; create `tWP >= 20 ns`, select both start transitions in the Inspector, and confirm two vertical start connectors plus one end connector. Drag the timing arrow, label, and wide hit target at different offsets to confirm smooth free vertical movement; rebind an endpoint to another valid slot and confirm its subset resets. Export JSON and confirm schema `1.1` uses only plural timing endpoint arrays, then import a schema `1.0` singleton document and confirm editor mode opens.

## MVP boundary

The first version deliberately excludes legacy image/PDF recognition, physical-time scaling, analog curves, buses, code generation, services, and collaboration. See [docs/spec.md](docs/spec.md) for the full Chinese product contract.
