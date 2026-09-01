# Multi-transition timing endpoints and smooth overlay drag

## Goal

Timing parameters must remain freely positionable above the waveform while showing exactly which signal transitions define each side of the interval. A start or end endpoint may reference multiple synchronous transitions, but it may never combine transitions from different order slots.

This change covers timing parameters only. Phase endpoints remain single-transition references.

## Domain rules

- A timing endpoint contains one or more transition references.
- Every transition in one endpoint belongs to the same order slot.
- The start endpoint's order slot must be strictly earlier than the end endpoint's order slot.
- Duplicate transition references within one endpoint are invalid.
- The timing parameter's vertical overlay position is presentation data and does not alter endpoint semantics.
- A whole-marker move preserves a synchronous group. Moving one transition out of a multi-transition endpoint is rejected until the endpoint selection is changed.

These terms and invariants are recorded in the root `CONTEXT.md`.

## JSON contract and migration

New documents use schema version `1.1`. A timing parameter uses plural canonical fields:

```json
{
  "id": "tp_twp",
  "name": "tWP",
  "startTransitionIds": ["tr_we_fall", "tr_ce_fall"],
  "endTransitionIds": ["tr_we_rise"],
  "requirementText": ">= 20 ns",
  "parsedRequirement": null,
  "validationStatus": "note",
  "tags": []
}
```

Known schema `1.0` documents are migrated before validation. Each `startTransitionId` and `endTransitionId` becomes a one-element array, the deprecated fields are removed, and `schemaVersion` becomes `1.1`. This deterministic migration applies both to imported JSON and local document-history snapshots. It does not guess missing references or repair invalid data; malformed legacy documents still enter repair mode after migration.

A schema `1.1` timing parameter must use the plural fields. Deprecated singular fields in a `1.1` document are a validation error so there is never more than one source of truth. Export emits only the `1.1` representation.

## Domain operations and validation

Timing-parameter create and update operations accept `startTransitionIds` and `endTransitionIds`. Creation from the existing select or canvas-pick flow supplies one transition per endpoint. Inspector edits may expand either endpoint with more transitions from its current order slot.

The validator checks that both arrays exist and are non-empty; every ID is unique and references an existing transition; all IDs within an endpoint resolve to one marker; and the start marker sequence precedes the end marker sequence.

Dependency lookup treats any member of either endpoint as a timing-parameter dependency. When deleting a referenced transition with confirmed cascade behavior, the transition is removed from a multi-member endpoint. The timing parameter remains when both endpoints are still non-empty; it is deleted only when removal would empty an endpoint. A deletion without confirmation remains blocked whenever dependencies exist.

Moving a complete marker keeps all endpoint members synchronous and is allowed when interval ordering remains valid. Moving an individual transition is rejected if it would split a multi-member endpoint or reverse/collapse a referenced timing interval. This prevents ordinary editing from leaving the document invalid.

## Inspector interaction

New timing parameters are still created by selecting one start transition and one end transition. The existing canvas two-pick flow also creates singleton endpoint arrays.

Each timing editor shows separate Start endpoint and End endpoint sections. Each section identifies its current order slot and lists that slot's transitions as checkboxes. The user may freely select a non-empty subset. Transitions from other slots are not shown in that checkbox group.

Dragging an endpoint handle to a transition in another valid order slot moves the endpoint there and resets that endpoint to the dropped transition. The user can then add other transitions in the new slot through the Inspector. Dropping on the endpoint's current slot preserves its existing subset. Invalid or unordered drops show a notice and leave the document unchanged.

## SVG rendering

The horizontal timing arrow remains at its saved overlay position. Each start and end reference renders a vertical connector from the corresponding horizontal-arrow endpoint to the referenced transition's signal-row position. A small timing-colored connection mark at the target distinguishes selected references from unrelated transitions in the same slot.

All transitions in one endpoint share the same x coordinate because they share an order slot, but each connector terminates at its own signal row. Signal waveforms render first and timing arrows, connectors, connection marks, labels, and handles render afterward so the timing relationship remains visible above the waveform layer.

The start and end drag handles remain at the horizontal arrow. Connector lines and target marks are visual references, not independent drag targets.

## Smooth vertical drag

Pointer-down records the offset between the pointer's SVG y coordinate and the timing arrow's current y coordinate. Pointer movement subtracts this grab offset before clamping the arrow to the signal overlay bounds. Therefore grabbing the label, arrow, or wide transparent hit target does not make the parameter jump to the pointer center.

The active timing group moves continuously during pointer movement. Pointer-up commits the last previewed normalized position rather than recomputing it without the grab offset. The normalized value is rounded to six decimal places and the renderer does not round the resulting SVG y coordinate; pointer cancellation restores the original rendered position and does not mutate the document.

Because connectors are children of the timing group, the arrow and all vertical connectors move together during the preview.

## Error handling and compatibility

- Unknown schema versions still enter repair mode.
- Known `1.0` data is migrated deterministically, then validated normally.
- Missing, empty, duplicated, cross-slot, dangling, same-slot start/end, or reversed endpoints are validation errors.
- Invalid drag or checkbox changes leave the prior document intact and display a user-facing notice.
- Legacy history entries are migrated on read and saved back in canonical form after the next successful edit.

## Testing

Domain tests will cover singleton creation, multi-transition updates, same-slot enforcement, ordering, dependency lookup, deletion behavior, individual-transition move protection, and complete-marker moves.

Import/export tests will cover `1.0` migration, `1.1` round trips, canonical export, malformed legacy input, and history snapshot migration.

Renderer tests will verify one vertical connector and target mark per referenced transition, shared endpoint x coordinates, distinct signal-row y coordinates, and timing-over-signal layer order.

Controller tests will verify checkbox rendering and multi-value form parsing, endpoint drag reset/preserve behavior, grab-offset math, continuous preview position, and pointer-up commit of the last previewed value.

The final gate includes the complete Node test suite, JavaScript syntax checks, the browser module-graph deployment test, and a browser smoke test that creates a two-signal synchronous endpoint, drags the timing overlay vertically, and rebinds an endpoint.

## Out of scope

- Multi-transition phase endpoints.
- Timing endpoints spanning multiple order slots.
- Direct Shift-click multi-selection on the canvas.
- Pixel coordinates in semantic data.
- Requirement-note parsing or rule-engine behavior.
