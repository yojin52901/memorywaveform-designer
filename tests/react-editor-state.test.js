import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialEditorState,
  runEditorOperation,
  splitTags,
  withExampleDocument,
  withImportedJson
} from '../src/react/editor-state.js';
import { addSignal } from '../src/domain/operations.js';

test('the React editor state keeps edits and fresh examples in browser history', () => {
  const initial = createInitialEditorState(null);
  const edited = runEditorOperation(initial, (documentModel) => addSignal(documentModel, {
    name: 'WE#', type: 'control', initialState: 'HIGH', tags: splitTags('write, active-low')
  }));
  const example = withExampleDocument(edited);

  assert.equal(edited.document.semantic.signals[0].name, 'WE#');
  assert.equal(example.document.metadata.title, 'Example document — ENVM power-on, write & power-off');
  assert.equal(example.history.entries.length, 2);
  assert.equal(example.history.entries.some((entry) => entry.snapshot.semantic.signals[0]?.name === 'WE#'), true);
});

test('the React editor state sends invalid JSON into repair mode without replacing history', () => {
  const initial = createInitialEditorState(null);
  const imported = withImportedJson(initial, '{not json');

  assert.equal(imported.mode, 'repair');
  assert.equal(imported.history.entries.length, initial.history.entries.length);
  assert.match(imported.validation.errors[0], /Unexpected token|Expected property name/);
});
