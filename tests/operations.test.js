import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import {
  addSignal,
  deleteTransitionWithDependencies,
  getMarkerSequence,
  getTransitionDependencies,
  deleteSignal,
  moveMarker,
  moveSignalRow,
  moveTransition,
  setSegmentBoundary,
  updateTransition,
  updateSignal
} from '../src/domain/operations.js';
import { addAnnotation, addTimingParameter, updateAnnotation } from '../src/domain/operations.js';
import { validateDocument } from '../src/domain/validate.js';

function setupSignal(name = 'WE#') {
  return addSignal(createDocument({ title: 'Program' }), {
    name,
    type: 'control',
    initialState: 'HIGH'
  });
}

test('adding a signal creates one segment covering the whole timeline', () => {
  const next = setupSignal();

  assert.equal(next.semantic.signals.length, 1);
  assert.equal(next.semantic.stateSegments.length, 1);
  assert.equal(next.semantic.stateSegments[0].state, 'HIGH');
  assert.equal(next.semantic.stateSegments[0].startMarkerId, 'tm_start');
  assert.equal(next.semantic.stateSegments[0].endMarkerId, 'tm_end');
});

test('splitting HIGH to LOW creates a derived falling transition', () => {
  const document = setupSignal();
  const signalId = document.semantic.signals[0].id;
  const next = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'LOW' });

  assert.equal(next.semantic.stateSegments.length, 2);
  assert.equal(next.semantic.transitions.length, 1);
  assert.equal(next.semantic.transitions[0].fromState, 'HIGH');
  assert.equal(next.semantic.transitions[0].toState, 'LOW');
  assert.equal(getMarkerSequence(next)[0].sequence, 10);
});

test('two signal transitions in one marker are a synchronous group', () => {
  const first = setupSignal('WE#');
  const withTwoSignals = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const we = withTwoSignals.semantic.signals[0].id;
  const ce = withTwoSignals.semantic.signals[1].id;
  const withWe = setSegmentBoundary(withTwoSignals, { signalId: we, sequence: 10, rightState: 'LOW' });
  const next = setSegmentBoundary(withWe, { signalId: ce, sequence: 10, rightState: 'LOW' });

  const [marker] = getMarkerSequence(next);
  assert.equal(marker.transitionIds.length, 2);
  assert.deepEqual(marker.transitionIds.sort(), next.semantic.transitions.map((transition) => transition.id).sort());
});

test('moving a transition can split a marker while preserving its ID', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;
  const falling = setSegmentBoundary(initial, { signalId, sequence: 10, rightState: 'LOW' });
  const rising = setSegmentBoundary(falling, { signalId, sequence: 30, rightState: 'HIGH' });
  const transitionId = rising.semantic.transitions[0].id;
  const moved = moveTransition(rising, { transitionId, targetSequence: 20 });

  assert.equal(moved.semantic.transitions.find((transition) => transition.id === transitionId).markerId !== 'tm_start', true);
  assert.deepEqual(getMarkerSequence(moved).map((marker) => marker.sequence), [20, 30]);
});

test('editing a transition updates its boundary and post-transition state while preserving its ID', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;
  const withFirstTransition = setSegmentBoundary(initial, { signalId, sequence: 10, rightState: 'LOW' });
  const waveform = setSegmentBoundary(withFirstTransition, { signalId, sequence: 30, rightState: 'HIGH' });
  const transitionId = waveform.semantic.transitions[0].id;

  const updated = updateTransition(waveform, transitionId, { sequence: 20, rightState: 'UNKNOWN' });
  const transition = updated.semantic.transitions.find((item) => item.id === transitionId);

  assert.equal(transition.markerId, updated.semantic.timeline.timeMarkers.find((marker) => marker.sequence === 20).id);
  assert.equal(transition.fromState, 'HIGH');
  assert.equal(transition.toState, 'UNKNOWN');
  assert.equal(validateDocument(updated).valid, true);
});

test('editing a transition can move it to another signal while preserving its ID', () => {
  const first = setupSignal('WE#');
  const document = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const weId = document.semantic.signals[0].id;
  const ceId = document.semantic.signals[1].id;
  const withTransition = setSegmentBoundary(document, { signalId: weId, sequence: 1, rightState: 'LOW' });
  const transitionId = withTransition.semantic.transitions[0].id;

  const updated = updateTransition(withTransition, transitionId, {
    signalId: ceId,
    sequence: 1,
    rightState: 'LOW'
  });

  assert.equal(updated.semantic.transitions.length, 1);
  assert.equal(updated.semantic.transitions[0].id, transitionId);
  assert.equal(updated.semantic.transitions[0].signalId, ceId);
  assert.equal(updated.semantic.stateSegments.filter((segment) => segment.signalId === weId).length, 1);
  assert.equal(validateDocument(updated).valid, true);
});

test('moving a marker moves its complete synchronous transition group', () => {
  const first = setupSignal('WE#');
  const withTwoSignals = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const we = withTwoSignals.semantic.signals[0].id;
  const ce = withTwoSignals.semantic.signals[1].id;
  const withWe = setSegmentBoundary(withTwoSignals, { signalId: we, sequence: 10, rightState: 'LOW' });
  const synchronous = setSegmentBoundary(withWe, { signalId: ce, sequence: 10, rightState: 'LOW' });
  const markerId = getMarkerSequence(synchronous)[0].id;
  const transitionIds = synchronous.semantic.transitions.map((transition) => transition.id).sort();
  const moved = moveMarker(synchronous, { markerId, targetSequence: 20 });

  assert.deepEqual(getMarkerSequence(moved).map((marker) => marker.sequence), [20]);
  assert.deepEqual(moved.semantic.transitions.map((transition) => transition.id).sort(), transitionIds);
});

test('dependency query is empty until timing objects reference a transition', () => {
  const document = setupSignal();
  const signalId = document.semantic.signals[0].id;
  const next = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'LOW' });
  const deps = getTransitionDependencies(next, next.semantic.transitions[0].id);

  assert.deepEqual(deps, { timingParameters: [], phases: [] });
  assert.equal(deleteTransitionWithDependencies(next, next.semantic.transitions[0].id).deleted, true);
});

test('signal metadata and display order can change without changing semantic transitions', () => {
  const first = setupSignal('WE#');
  const withTwoSignals = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const updated = updateSignal(withTwoSignals, withTwoSignals.semantic.signals[0].id, { name: 'WEB#', subtype: 'write-enable', tags: ['active-low'] });
  const moved = moveSignalRow(updated, { signalId: updated.semantic.signals[0].id, targetIndex: 1 });

  assert.equal(moved.semantic.signals[0].name, 'WEB#');
  assert.deepEqual(moved.presentation.signalRowOrder, [updated.semantic.signals[1].id, updated.semantic.signals[0].id]);
});

test('editing a signal can change its initial state', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;

  const updated = updateSignal(initial, signalId, { initialState: 'LOW' });

  assert.equal(updated.semantic.signals[0].initialState, 'LOW');
  assert.equal(updated.semantic.stateSegments[0].state, 'LOW');
  assert.equal(validateDocument(updated).valid, true);
});

test('editing an annotation can change its text and anchor', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;
  const annotated = addAnnotation(initial, { text: 'before write', anchorType: 'document' });
  const annotationId = annotated.semantic.annotations[0].id;

  const updated = updateAnnotation(annotated, annotationId, {
    text: 'after write',
    anchorType: 'signal',
    anchorId: signalId
  });

  assert.deepEqual(updated.semantic.annotations[0], {
    id: annotationId,
    text: 'after write',
    anchorType: 'signal',
    anchorId: signalId
  });
  assert.equal(validateDocument(updated).valid, true);
});

test('deleting a signal removes its transitions and dependent presentation references', () => {
  const document = setupSignal();
  const signalId = document.semantic.signals[0].id;
  const withTransition = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'LOW' });
  const deleted = deleteSignal(withTransition, signalId);

  assert.equal(deleted.semantic.signals.length, 0);
  assert.equal(deleted.semantic.transitions.length, 0);
  assert.deepEqual(deleted.presentation.signalRowOrder, []);
  assert.deepEqual(deleted.semantic.timeline.timeMarkers, []);
});

test('cascading a transition deletion removes annotations on every deleted object', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;
  const low = setSegmentBoundary(initial, { signalId, sequence: 10, rightState: 'LOW' });
  const high = setSegmentBoundary(low, { signalId, sequence: 30, rightState: 'HIGH' });
  const startTransition = high.semantic.transitions[0];
  const endTransition = high.semantic.transitions[1];
  const withTiming = addTimingParameter(high, {
    name: 'tWP', startTransitionId: startTransition.id, endTransitionId: endTransition.id, requirementText: '>= 20 ns'
  });
  const withTransitionNote = addAnnotation(withTiming, { text: 'edge note', anchorType: 'transition', anchorId: startTransition.id });
  const withParameterNote = addAnnotation(withTransitionNote, { text: 'rule note', anchorType: 'timingParameter', anchorId: withTiming.semantic.timingParameters[0].id });
  const result = deleteTransitionWithDependencies(withParameterNote, startTransition.id, { cascade: true });

  assert.equal(result.document.semantic.annotations.length, 0);
  assert.equal(validateDocument(result.document).valid, true);
});

test('deleting an unreferenced transition still removes its anchored annotation', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;
  const withTransition = setSegmentBoundary(initial, { signalId, sequence: 10, rightState: 'LOW' });
  const transitionId = withTransition.semantic.transitions[0].id;
  const annotated = addAnnotation(withTransition, { text: 'edge note', anchorType: 'transition', anchorId: transitionId });
  const result = deleteTransitionWithDependencies(annotated, transitionId);

  assert.equal(result.deleted, true);
  assert.equal(result.document.semantic.annotations.length, 0);
  assert.equal(validateDocument(result.document).valid, true);
});
