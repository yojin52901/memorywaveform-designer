import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import { addSignal, addTimingParameter, setSegmentBoundary, updateTimingParameter } from '../src/domain/operations.js';
import { validateDocument } from '../src/domain/validate.js';

function validWaveform() {
  const withSignal = addSignal(createDocument({ title: 'Program' }), {
    name: 'WE#', type: 'control', initialState: 'HIGH'
  });
  const signalId = withSignal.semantic.signals[0].id;
  const falling = setSegmentBoundary(withSignal, { signalId, sequence: 10, rightState: 'LOW' });
  const rising = setSegmentBoundary(falling, { signalId, sequence: 30, rightState: 'HIGH' });
  const [startTransition, endTransition] = rising.semantic.transitions;
  return addTimingParameter(rising, {
    name: 'tWP',
    startTransitionId: startTransition.id,
    endTransitionId: endTransition.id,
    requirementText: '>= 20 ns'
  });
}

test('a complete waveform with parsed timing rule is valid', () => {
  const result = validateDocument(validWaveform());
  assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
});

test('rejects reversed or same-marker timing endpoints', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  [parameter.startTransitionId, parameter.endTransitionId] = [parameter.endTransitionId, parameter.startTransitionId];

  const result = validateDocument(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /strictly left-to-right/);
});

test('reports dangling references and incomplete signal coverage', () => {
  const document = validWaveform();
  document.semantic.timingParameters[0].endTransitionId = 'tr_missing';
  document.semantic.stateSegments.pop();

  const result = validateDocument(document);
  assert.equal(result.errors.length > 0, true);
  assert.match(result.errors.join('\n'), /missing|cover/i);
});

test('unparsed timing text remains editable but is not export-valid', () => {
  const document = validWaveform();
  document.semantic.timingParameters[0].requirementText = 'about twenty ns';
  document.semantic.timingParameters[0].validationStatus = 'unparsed';
  document.semantic.timingParameters[0].parsedRequirement = null;

  assert.equal(validateDocument(document).valid, false);
});

test('rebinding a timing endpoint preserves the parameter identity', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  const added = setSegmentBoundary(document, { signalId: document.semantic.signals[0].id, sequence: 20, rightState: 'UNKNOWN' });
  const targetTransition = added.semantic.transitions.find((transition) => transition.id !== parameter.startTransitionId && transition.id !== parameter.endTransitionId);
  const updated = updateTimingParameter(added, parameter.id, {
    startTransitionId: added.semantic.transitions[0].id,
    endTransitionId: targetTransition.id
  });

  assert.equal(updated.semantic.timingParameters[0].id, parameter.id);
});

test('rejects invalid signal types and duplicate cross-marker transition membership', () => {
  const document = validWaveform();
  document.semantic.signals[0].type = 'wat';
  const transitionId = document.semantic.transitions[0].id;
  document.semantic.timeline.timeMarkers.push({ id: 'tm_extra', sequence: 20, transitionIds: [transitionId] });

  const result = validateDocument(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /signal type|belongs to a different marker/i);
});
