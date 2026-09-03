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
    startTransitionIds: [startTransition.id],
    endTransitionIds: [endTransition.id],
    requirementText: '>= 20 ns'
  });
}

test('a complete waveform with parsed timing rule is valid', () => {
  const result = validateDocument(validWaveform());
  assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
});

test('rejects reversed timing endpoints', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  [parameter.startTransitionIds, parameter.endTransitionIds] = [parameter.endTransitionIds, parameter.startTransitionIds];

  const result = validateDocument(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /strictly left-to-right/);
});

test('reports dangling references and incomplete signal coverage', () => {
  const document = validWaveform();
  document.semantic.timingParameters[0].endTransitionIds = ['tr_missing'];
  document.semantic.stateSegments.pop();

  const result = validateDocument(document);
  assert.equal(result.errors.length > 0, true);
  assert.match(result.errors.join('\n'), /missing|cover/i);
});

test('free-form timing notes never affect document validity', () => {
  const document = validWaveform();
  document.semantic.timingParameters[0].requirementText = 'tWP ≥ 20 ns; characterize at hot corner';
  document.semantic.timingParameters[0].validationStatus = 'unparsed';
  document.semantic.timingParameters[0].parsedRequirement = { stale: true };

  const result = validateDocument(document);
  assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
});

test('allows timing endpoints without a requirement DSL', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  const updated = updateTimingParameter(document, parameter.id, { requirementText: '' });

  assert.equal(updated.semantic.timingParameters[0].validationStatus, 'note');
  assert.equal(updated.semantic.timingParameters[0].parsedRequirement, null);
  assert.deepEqual(validateDocument(updated), { valid: true, errors: [], warnings: [] });
});

test('ignores legacy parsed requirement metadata', () => {
  const document = validWaveform();
  document.semantic.timingParameters[0].parsedRequirement = null;
  document.semantic.timingParameters[0].validationStatus = 'unparsed';

  const result = validateDocument(document);
  assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
});

test('rebinding a timing endpoint preserves the parameter identity', () => {
  const document = validWaveform();
  const parameter = document.semantic.timingParameters[0];
  const added = setSegmentBoundary(document, { signalId: document.semantic.signals[0].id, sequence: 20, rightState: 'UNKNOWN' });
  const targetTransition = added.semantic.transitions.find((transition) => !parameter.startTransitionIds.includes(transition.id) && !parameter.endTransitionIds.includes(transition.id));
  const updated = updateTimingParameter(added, parameter.id, {
    startTransitionIds: [added.semantic.transitions[0].id],
    endTransitionIds: [targetTransition.id]
  });

  assert.equal(updated.semantic.timingParameters[0].id, parameter.id);
});

test('rejects missing plural timing fields and deprecated singular fields', () => {
  const missingArrays = validWaveform();
  delete missingArrays.semantic.timingParameters[0].startTransitionIds;
  const singularFields = validWaveform();
  singularFields.semantic.timingParameters[0].startTransitionId = singularFields.semantic.timingParameters[0].startTransitionIds[0];

  assert.match(validateDocument(missingArrays).errors.join('\n'), /at least one transition/);
  assert.match(validateDocument(singularFields).errors.join('\n'), /deprecated singular/i);
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

test('rejects invalid or dangling timing parameter presentation positions', () => {
  const document = validWaveform();
  const parameterId = document.semantic.timingParameters[0].id;
  document.presentation.timingParameterPositions[parameterId] = 1.5;
  document.presentation.timingParameterPositions.tp_missing = 0.5;

  const result = validateDocument(document);

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /position.*between 0 and 1/i);
  assert.match(result.errors.join('\n'), /missing timing parameter/i);
});

test('rejects slot width entries with invalid boundary keys or values', () => {
  const document = validWaveform();
  document.presentation.slotWidthUnits = { tm_end: 1, tm_missing: 1, tm_start: 0.39 };

  const result = validateDocument(document);

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /slot width.*boundary|slot width.*between 0.4 and 4/i);
});

test('allows legacy equal-width presentation with no slot width field', () => {
  const document = validWaveform();
  delete document.presentation.slotWidthUnits;

  assert.deepEqual(validateDocument(document), { valid: true, errors: [], warnings: [] });
});
