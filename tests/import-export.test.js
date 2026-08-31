import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import { addSignal, addTimingParameter, setSegmentBoundary } from '../src/domain/operations.js';
import { exportDocumentJson, getPngExportPolicy, loadDocumentJson } from '../src/domain/import-export.js';

function validDocument() {
  const withSignal = addSignal(createDocument({ title: 'Program' }), { name: 'WE#', type: 'control', initialState: 'HIGH' });
  const signalId = withSignal.semantic.signals[0].id;
  const low = setSegmentBoundary(withSignal, { signalId, sequence: 10, rightState: 'LOW' });
  const high = setSegmentBoundary(low, { signalId, sequence: 30, rightState: 'HIGH' });
  return addTimingParameter(high, {
    name: 'tWP',
    startTransitionId: high.semantic.transitions[0].id,
    endTransitionId: high.semantic.transitions[1].id,
    requirementText: '>= 20 ns'
  });
}

test('round-trips a valid normalized document', () => {
  const document = validDocument();
  const imported = loadDocumentJson(exportDocumentJson(document));

  assert.equal(imported.mode, 'editor');
  assert.equal(imported.canRender, true);
  assert.deepEqual(imported.document, document);
});

test('loads legacy documents that do not have timing parameter positions', () => {
  const document = validDocument();
  delete document.presentation.timingParameterPositions;

  const imported = loadDocumentJson(JSON.stringify(document));

  assert.equal(imported.mode, 'editor');
  assert.equal(imported.canRender, true);
});

test('keeps invalid imported JSON in non-rendering repair mode', () => {
  const document = validDocument();
  document.semantic.timingParameters[0].endTransitionId = 'tr_missing';

  const imported = loadDocumentJson(JSON.stringify(document));
  assert.equal(imported.mode, 'repair');
  assert.equal(imported.canRender, false);
  assert.equal(imported.validation.errors.length > 0, true);
});

test('a free-form timing note exports without validation messages', () => {
  const document = validDocument();
  document.semantic.timingParameters[0].requirementText = 'roughly twenty ns';
  document.semantic.timingParameters[0].parsedRequirement = null;
  document.semantic.timingParameters[0].validationStatus = 'unparsed';

  assert.doesNotThrow(() => exportDocumentJson(document));
  assert.deepEqual(getPngExportPolicy(document), { allowed: true, draft: false });
  assert.deepEqual(loadDocumentJson(exportDocumentJson(document)).validation, { valid: true, errors: [], warnings: [] });
});

test('malformed JSON enters repair mode without throwing', () => {
  const imported = loadDocumentJson('{ nope');
  assert.equal(imported.mode, 'repair');
  assert.equal(imported.document, null);
});

test('parseable but incomplete JSON stays available to repair mode', () => {
  const raw = { schemaVersion: '1.0', metadata: { title: 'Broken' }, semantic: { timeline: {} }, presentation: {} };
  const imported = loadDocumentJson(JSON.stringify(raw));

  assert.equal(imported.mode, 'repair');
  assert.deepEqual(imported.document, raw);
  assert.equal(imported.validation.errors.length > 0, true);
});

test('null collection entries are preserved and reported without crashing repair mode', () => {
  const raw = {
    schemaVersion: '1.0', metadata: { title: 'Broken' },
    semantic: { signals: [null], timeline: { startMarkerId: 'tm_start', endMarkerId: 'tm_end', timeMarkers: [] }, stateSegments: [], transitions: [], timingParameters: [], phases: [], annotations: [] },
    presentation: { signalRowOrder: [], timingLaneOrder: [] }
  };
  const imported = loadDocumentJson(JSON.stringify(raw));

  assert.equal(imported.mode, 'repair');
  assert.deepEqual(imported.document, raw);
  assert.match(imported.validation.errors.join('\n'), /signals\[0\].*object/i);
});
