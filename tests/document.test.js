import assert from 'node:assert/strict';
import test from 'node:test';

import { cloneDocument, createDocument } from '../src/domain/document.js';

test('new documents have immutable timeline boundaries and a title', () => {
  const document = createDocument({ title: 'Program waveform' });

  assert.equal(document.schemaVersion, '1.1');
  assert.equal(document.metadata.title, 'Program waveform');
  assert.equal(document.semantic.timeline.startMarkerId, 'tm_start');
  assert.equal(document.semantic.timeline.endMarkerId, 'tm_end');
  assert.deepEqual(document.semantic.timeline.timeMarkers, []);
});

test('new documents initialize presentation slot widths', () => {
  assert.deepEqual(createDocument({ title: 'Program' }).presentation.slotWidthUnits, {});
});

test('cloneDocument creates a detached editable copy', () => {
  const original = createDocument({ title: 'Original' });
  const copy = cloneDocument(original);

  copy.metadata.title = 'Changed';
  assert.equal(original.metadata.title, 'Original');
});
