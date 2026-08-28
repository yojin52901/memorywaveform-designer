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

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  };
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
