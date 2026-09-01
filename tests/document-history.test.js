import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import {
  HISTORY_STORAGE_KEY,
  appendHistoryEntry,
  createHistoryEntry,
  createHistoryState,
  loadHistory,
  replaceActiveHistoryEntry,
  saveHistory,
  selectHistoryEntry
} from '../src/ui/document-history.js';
import { addSignal, addTimingParameter, setSegmentBoundary } from '../src/domain/operations.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  };
}

function validDocument() {
  const withSignal = addSignal(createDocument({ title: 'Program' }), { name: 'WE#', type: 'control', initialState: 'HIGH' });
  const signalId = withSignal.semantic.signals[0].id;
  const low = setSegmentBoundary(withSignal, { signalId, sequence: 10, rightState: 'LOW' });
  const high = setSegmentBoundary(low, { signalId, sequence: 30, rightState: 'HIGH' });
  return addTimingParameter(high, {
    name: 'tWP', startTransitionIds: [high.semantic.transitions[0].id], endTransitionIds: [high.semantic.transitions[1].id]
  });
}

function legacyHistoryPayload(document) {
  const snapshot = structuredClone(document);
  snapshot.schemaVersion = '1.0';
  for (const parameter of snapshot.semantic.timingParameters) {
    parameter.startTransitionId = parameter.startTransitionIds[0];
    parameter.endTransitionId = parameter.endTransitionIds[0];
    delete parameter.startTransitionIds;
    delete parameter.endTransitionIds;
  }
  return { activeId: 'doc-1', entries: [{ id: 'doc-1', title: snapshot.metadata.title, updatedAt: 1, snapshot }] };
}

test('history stores one cloned latest snapshot per document', () => {
  const document = createDocument({ title: 'First' });
  const entry = createHistoryEntry(document, { id: 'doc-1', now: 100 });
  const history = createHistoryState(entry);
  document.metadata.title = 'Mutated outside';

  assert.equal(history.entries[0].snapshot.metadata.title, 'First');

  const updated = createDocument({ title: 'Updated' });
  const replaced = replaceActiveHistoryEntry(history, updated, 200);
  assert.equal(replaced.entries.length, 1);
  assert.equal(replaced.entries[0].snapshot.metadata.title, 'Updated');
  assert.equal(replaced.entries[0].updatedAt, 200);
});

test('history appends and selects documents without sharing snapshots', () => {
  const first = createHistoryEntry(createDocument({ title: 'First' }), { id: 'doc-1', now: 100 });
  const second = createHistoryEntry(createDocument({ title: 'Second' }), { id: 'doc-2', now: 200 });
  const appended = appendHistoryEntry(createHistoryState(first), second);
  const selected = selectHistoryEntry(appended, 'doc-1');

  assert.equal(appended.activeId, 'doc-2');
  assert.equal(selected.history.activeId, 'doc-1');
  assert.equal(selected.snapshot.metadata.title, 'First');
  selected.snapshot.metadata.title = 'Local edit';
  assert.equal(selected.history.entries[0].snapshot.metadata.title, 'First');
});

test('history storage failures fall back without throwing', () => {
  const fallback = createHistoryEntry(createDocument({ title: 'Fallback' }), { id: 'fallback', now: 1 });
  const malformed = memoryStorage({ [HISTORY_STORAGE_KEY]: '{not json' });
  const loaded = loadHistory(malformed, fallback);
  assert.equal(loaded.history.activeId, 'fallback');
  assert.match(loaded.notice, /could not be read/i);

  const storage = memoryStorage();
  assert.equal(saveHistory(storage, loaded.history).saved, true);
  assert.match(storage.value(HISTORY_STORAGE_KEY), /fallback/);

  const blocked = { setItem() { throw new Error('quota'); } };
  assert.equal(saveHistory(blocked, loaded.history).saved, false);
});

test('preserves known legacy history snapshots until selection migrates them', () => {
  const raw = legacyHistoryPayload(validDocument());
  const loaded = loadHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(raw) }), createHistoryEntry(validDocument()));
  const selected = selectHistoryEntry(loaded.history, 'doc-1');

  assert.equal(loaded.history.entries[0].snapshot.schemaVersion, '1.0');
  assert.equal('startTransitionId' in loaded.history.entries[0].snapshot.semantic.timingParameters[0], true);
  assert.equal(selected.document.schemaVersion, '1.1');
  assert.equal('startTransitionId' in selected.document.semantic.timingParameters[0], false);
});

test('preserves malformed legacy history snapshots for repair on selection', () => {
  const snapshot = validDocument();
  snapshot.schemaVersion = '1.0';
  snapshot.semantic.timingParameters = {};
  const raw = {
    activeId: 'broken',
    entries: [{ id: 'broken', title: snapshot.metadata.title, updatedAt: 1, snapshot }]
  };

  const loaded = loadHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(raw) }), createHistoryEntry(validDocument()));
  const selected = selectHistoryEntry(loaded.history, 'broken');

  assert.equal(loaded.history.activeId, 'broken');
  assert.equal(loaded.history.entries.length, 1);
  assert.equal(loaded.history.entries[0].snapshot.semantic.timingParameters.constructor, Object);
  assert.equal(selected.mode, 'repair');
  assert.match(selected.repairText, /"timingParameters": \{\}/);
});

test('preserves an active null snapshot for repair on selection', () => {
  const raw = {
    activeId: 'null-document',
    entries: [{ id: 'null-document', title: 'Null document', updatedAt: 1, snapshot: null }]
  };

  const loaded = loadHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(raw) }), createHistoryEntry(validDocument()));
  const selected = selectHistoryEntry(loaded.history, 'null-document');

  assert.equal(loaded.history.activeId, 'null-document');
  assert.equal(loaded.history.entries.length, 1);
  assert.equal(loaded.history.entries[0].snapshot, null);
  assert.equal(selected.mode, 'repair');
  assert.equal(selected.repairText, 'null');
});

test('selecting malformed known history returns a repair outcome without dropping the entry', () => {
  const malformed = {
    schemaVersion: '1.0',
    metadata: { title: 'Broken legacy waveform' },
    semantic: { timeline: {} },
    presentation: {}
  };
  const raw = { activeId: 'broken', entries: [{ id: 'broken', title: 'Broken legacy waveform', updatedAt: 1, snapshot: malformed }] };
  const loaded = loadHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify(raw) }), createHistoryEntry(validDocument()));

  const selected = selectHistoryEntry(loaded.history, 'broken');

  assert.equal(selected.history.entries.length, 1);
  assert.equal(selected.history.activeId, 'broken');
  assert.equal(selected.mode, 'repair');
  assert.equal(selected.validation.valid, false);
  assert.equal(selected.document.schemaVersion, '1.1');
  assert.match(selected.repairText, /Broken legacy waveform/);
});

test('selecting unknown-version history returns a repair outcome without dropping the entry', () => {
  const unknown = validDocument();
  unknown.schemaVersion = '2.0';
  const history = createHistoryState(createHistoryEntry(unknown, { id: 'unknown', now: 1 }));

  const selected = selectHistoryEntry(history, 'unknown');

  assert.equal(selected.history.entries.length, 1);
  assert.equal(selected.mode, 'repair');
  assert.equal(selected.document.schemaVersion, '2.0');
  assert.match(selected.validation.errors.join('\n'), /Unsupported schema version: 2\.0/);
  assert.match(selected.repairText, /"schemaVersion": "2\.0"/);
});
