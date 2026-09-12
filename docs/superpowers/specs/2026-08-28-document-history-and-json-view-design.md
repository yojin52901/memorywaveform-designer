# Document History, Note-Only DSL, and JSON View Design

## Goal

Make early waveform authoring frictionless. A timing parameter's text is an
engineering note, not a rule-engine contract. Designers can keep several
browser-local waveform documents, open any one from a collapsed left sidebar,
and inspect the current valid document as waveform or JSON without creating a
second source of truth.

## Scope

This change covers four connected behaviours:

1. `requirementText` is an optional timing note and never makes a document
   invalid.
2. The left sidebar owns a collapsed, browser-persistent document history.
3. Every authoring tool in that sidebar is independently collapsed by default.
4. A valid document can switch the middle pane between waveform and derived
   read-only JSON.

It does not add cloud sync, collaboration, per-edit undo history, rule-engine
execution, or editable JSON outside the existing import repair flow.

## Data model

### Timing parameter note

`timingParameters[].requirementText` remains for JSON compatibility, but its
meaning becomes free-form `requirementNote` content in the UI. It may be empty
or contain any text. `parsedRequirement` and `validationStatus` are legacy
metadata: imports may preserve them, but validation and UI behaviour must not
depend on them. New or edited timing parameters use `validationStatus: "note"`
and `parsedRequirement: null`.

The validator continues to enforce structural waveform rules only: immutable
timeline boundaries, segment coverage, marker membership, valid transition
derivation, left-to-right relation endpoints, references, and presentation
references. It performs no DSL parsing or DSL consistency validation.

### Browser document history

History is browser-local, outside exported waveform JSON, and stores the latest
state of each document rather than an entry per edit. It is persisted under a
versioned `localStorage` key such as `memorywaveform-designer.history.v1`.

```json
{
  "activeHistoryId": "hist_01",
  "entries": [
    {
      "id": "hist_01",
      "title": "Program waveform",
      "updatedAt": "2026-08-28T05:00:00.000Z",
      "mode": "editor",
      "document": { "...": "normalized waveform document" },
      "repairText": ""
    }
  ]
}
```

`validation` is derived whenever an entry is opened; it is never persisted.
An imported repair-mode document is retained with its raw `repairText` so it
can be reopened for repair without rendering a malformed waveform.

On first use, the initial Untitled waveform becomes the first entry. Creating a
new document or importing JSON creates a new history entry. Every successful
authoring operation, metadata edit, repair update, or history switch updates
the active entry's snapshot and timestamp. Selecting an entry restores its
mode, document, raw repair text, and selection-free editor state.

The history adapter must handle malformed or quota-exceeded `localStorage`
without corrupting the active in-memory document. The editor remains usable and
shows a clear notice if persistence fails.

## UI behaviour

### Left sidebar

The sidebar starts with a closed `Document history` disclosure. Its summary
shows the number of stored documents. Opening it shows each entry's title,
updated time, current/repair status, and active selection. Selecting an entry
opens that document; there is no data-loss confirmation because the active
document is automatically snapshotted first.

`Add signal`, `Add state transition`, `Timing parameter`, `Phase`, and
`Annotation` are each rendered as separate closed disclosures. The history
section and every authoring section are closed on first render and after a
normal rerender. The current document's editable data is not hidden elsewhere.

The timing tool label changes to `Requirement note (optional)`. It does not
show parser formats, rule warnings, parsed state, or JSON validity restrictions.

### Middle pane

In normal editor mode the pane always renders the waveform canvas, whether the
document is valid or draft. A valid document additionally displays a two-choice
view switcher:

- **Waveform** (default): renders the SVG canvas and existing drag behaviour.
- **JSON**: renders `exportDocumentJson(currentDocument)` as pretty, read-only
  text. It is derived at render time and never becomes editable application
  state.

The JSON switcher is unavailable when structural validation fails. Repair mode
continues to show only its existing raw JSON repair editor and never renders the
canvas or derived JSON viewer.

## Module boundaries

- `src/domain/operations.js`: write timing notes without parsing or derived DSL
  requirements.
- `src/domain/validate.js`: remove all requirement-text checks; preserve only
  structural validation.
- `src/ui/document-history.js`: own history serialization, loading, saving,
  snapshot replacement, and graceful storage-failure results.
- `src/ui/controller.js`: orchestrate active history, disclosures, document
  switching, and waveform/JSON view state. It must never parse or duplicate
  waveform semantics.
- `src/ui/styles.css`: style compact disclosure summaries, history entries,
  active state, and the middle-pane switcher.

## Error handling

- A free-form or empty timing note is always valid with respect to DSL.
- Structural validation failures still show the current invalid summary and
  block semantic JSON export as before.
- A history entry that cannot be decoded is ignored; other valid entries remain
  available and the editor creates a usable new entry when necessary.
- Browser storage failures do not erase the active document; they surface a
  non-blocking notice.

## Verification

Tests must prove that:

1. Empty, free-form, and parser-looking timing notes all validate and export.
2. Existing `parsedRequirement` metadata cannot make a document invalid.
3. History saves and reloads the latest document snapshot, restores a selected
   document, and leaves the active document usable when storage fails.
4. History and each authoring tool render as closed disclosures by default.
5. A valid editor document renders the waveform by default and can render the
   current derived JSON; a structural draft cannot open the derived JSON view.
6. Repair mode still suppresses waveform and derived JSON rendering.
