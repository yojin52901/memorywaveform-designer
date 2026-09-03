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
  rebindTimingEndpoint,
  setSlotWidth,
  setTimingParameterPosition,
  setSegmentBoundary,
  updateTransition,
  updateSignal
} from '../src/domain/operations.js';
import { addAnnotation, addPhase, addTimingParameter, updateAnnotation, updateTimingParameter } from '../src/domain/operations.js';
import { validateDocument } from '../src/domain/validate.js';

function setupSignal(name = 'WE#') {
  return addSignal(createDocument({ title: 'Program' }), {
    name,
    type: 'control',
    initialState: 'HIGH'
  });
}

function transitionsAt(document, sequence) {
  const marker = document.semantic.timeline.timeMarkers.find((item) => item.sequence === sequence);
  return marker.transitionIds.map((id) => document.semantic.transitions.find((item) => item.id === id));
}

function synchronousTwoSignalWaveform() {
  let document = createDocument({ title: 'Synchronous timing' });
  document = addSignal(document, { name: 'WE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const [we, ce] = document.semantic.signals;
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 10, rightState: 'LOW' });
  return setSegmentBoundary(document, { signalId: we.id, sequence: 30, rightState: 'HIGH' });
}

function multiEndpointFixture() {
  let document = synchronousTwoSignalWaveform();
  const startTransitions = transitionsAt(document, 10);
  const endTransition = transitionsAt(document, 30)[0];
  document = addTimingParameter(document, {
    name: 'tSYNC',
    startTransitionIds: startTransitions.map((item) => item.id),
    endTransitionIds: [endTransition.id]
  });
  document = addSignal(document, { name: 'OE#', type: 'control', initialState: 'HIGH' });
  const oe = document.semantic.signals.find((item) => item.name === 'OE#');
  document = setSegmentBoundary(document, { signalId: oe.id, sequence: 20, rightState: 'LOW' });
  return {
    document,
    parameterId: document.semantic.timingParameters[0].id,
    selectedStart: startTransitions[0],
    newStart: transitionsAt(document, 20)[0]
  };
}

function phaseMoveFixture() {
  let document = createDocument({ title: 'Phase move validation' });
  document = addSignal(document, { name: 'WE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'OE#', type: 'control', initialState: 'HIGH' });
  const [we, ce, oe] = document.semantic.signals;
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: oe.id, sequence: 20, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 30, rightState: 'HIGH' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 30, rightState: 'HIGH' });
  const startTransition = transitionsAt(document, 10).find((item) => item.signalId === we.id);
  const endTransition = transitionsAt(document, 20).find((item) => item.signalId === oe.id);
  document = addPhase(document, {
    name: 'write cycle', startTransitionId: startTransition.id, endTransitionId: endTransition.id
  });
  return { document, startTransition, startMarkerId: startTransition.markerId, oeId: oe.id };
}

function crossingRelationFixture() {
  let document = createDocument({ title: 'Crossing relation' });
  document = addSignal(document, { name: 'WE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const [we, ce] = document.semantic.signals;
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 20, rightState: 'LOW' });
  const startTransition = transitionsAt(document, 10)[0];
  const endTransition = transitionsAt(document, 20)[0];
  return { document, startTransition, endTransition };
}

function overlappingTimingEndpointFixture() {
  let document = createDocument({ title: 'Overlapping timing endpoints' });
  document = addSignal(document, { name: 'WE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'OE#', type: 'control', initialState: 'HIGH' });
  const [we, ce, oe] = document.semantic.signals;
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 5, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 10, rightState: 'HIGH' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: oe.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 30, rightState: 'LOW' });
  const weAt5 = transitionsAt(document, 5)[0];
  const [weAt10, ceAt10, oeAt10] = transitionsAt(document, 10);
  const weAt30 = transitionsAt(document, 30)[0];
  document = addTimingParameter(document, {
    name: 'tPrimary', startTransitionIds: [weAt10.id, ceAt10.id], endTransitionIds: [weAt30.id]
  });
  document = addTimingParameter(document, {
    name: 'tDependent', startTransitionIds: [weAt5.id], endTransitionIds: [ceAt10.id, oeAt10.id]
  });
  return { document, weAt10, ceAt10, oeAt10 };
}

test('adding a signal creates one segment covering the whole timeline', () => {
  const next = setupSignal();

  assert.equal(next.semantic.signals.length, 1);
  assert.equal(next.semantic.stateSegments.length, 1);
  assert.equal(next.semantic.stateSegments[0].state, 'HIGH');
  assert.equal(next.semantic.stateSegments[0].startMarkerId, 'tm_start');
  assert.equal(next.semantic.stateSegments[0].endMarkerId, 'tm_end');
});

test('saving a slot width is presentation-only and rounds to six decimals', () => {
  const document = setupSignal();
  const updated = setSlotWidth(document, { startMarkerId: 'tm_start', widthUnits: 1.2345678 });

  assert.equal(updated.presentation.slotWidthUnits.tm_start, 1.234568);
  assert.deepEqual(updated.semantic, document.semantic);
  assert.notEqual(updated, document);
});

test('removing a marker removes its stale outgoing slot-width entry', () => {
  const document = setupSignal();
  const signalId = document.semantic.signals[0].id;
  const withMarker = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'LOW' });
  const markerId = withMarker.semantic.timeline.timeMarkers[0].id;
  const withSlotWidth = setSlotWidth(withMarker, { startMarkerId: markerId, widthUnits: 2 });

  const updated = deleteSignal(withSlotWidth, signalId);

  assert.equal(markerId in updated.presentation.slotWidthUnits, false);
});

test('saving a timing position rounds to six decimal places', () => {
  let document = setupSignal();
  const signalId = document.semantic.signals[0].id;
  document = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId, sequence: 30, rightState: 'HIGH' });
  const [start, end] = document.semantic.transitions;
  document = addTimingParameter(document, {
    name: 'tWP', startTransitionIds: [start.id], endTransitionIds: [end.id]
  });

  const updated = setTimingParameterPosition(document, {
    parameterId: document.semantic.timingParameters[0].id,
    position: 0.1234567
  });

  assert.equal(updated.presentation.timingParameterPositions[document.semantic.timingParameters[0].id], 0.123457);
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

test('moving a phase start transition onto its end slot is rejected', () => {
  const { document, startTransition } = phaseMoveFixture();

  assert.throws(
    () => moveTransition(document, { transitionId: startTransition.id, targetSequence: 20 }),
    /Relation endpoints must be distinct and strictly left-to-right\./
  );
});

test('moving a phase marker past its end swaps phase endpoint direction', () => {
  const { document, startTransition, startMarkerId } = phaseMoveFixture();
  const endTransitionId = document.semantic.phases[0].endTransitionId;

  const updated = moveMarker(document, { markerId: startMarkerId, targetSequence: 25 });

  assert.equal(updated.semantic.phases[0].startTransitionId, endTransitionId);
  assert.equal(updated.semantic.phases[0].endTransitionId, startTransition.id);
  assert.equal(validateDocument(updated).valid, true);
});

test('editing a phase start into another signal past its end swaps phase direction', () => {
  const { document, startTransition, oeId } = phaseMoveFixture();
  const endTransitionId = document.semantic.phases[0].endTransitionId;

  const updated = updateTransition(document, startTransition.id, {
    signalId: oeId,
    sequence: 25,
    rightState: 'UNKNOWN'
  });

  const moved = updated.semantic.transitions.find((item) => item.id === startTransition.id);
  assert.equal(moved.signalId, oeId);
  assert.equal(updated.semantic.timeline.timeMarkers.find((marker) => marker.id === moved.markerId).sequence, 25);
  assert.equal(moved.toState, 'UNKNOWN');
  assert.equal(updated.semantic.phases[0].startTransitionId, endTransitionId);
  assert.equal(updated.semantic.phases[0].endTransitionId, startTransition.id);
  assert.equal(validateDocument(updated).valid, true);
});

test('dependency query is empty until timing objects reference a transition', () => {
  const document = setupSignal();
  const signalId = document.semantic.signals[0].id;
  const next = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'LOW' });
  const deps = getTransitionDependencies(next, next.semantic.transitions[0].id);

  assert.deepEqual(deps, { timingParameters: [], phases: [] });
  assert.equal(deleteTransitionWithDependencies(next, next.semantic.transitions[0].id).deleted, true);
});

test('accepts a selected subset from one synchronous transition group', () => {
  const document = synchronousTwoSignalWaveform();
  const [startA, startB] = transitionsAt(document, 10);
  const [end] = transitionsAt(document, 30);

  const updated = addTimingParameter(document, {
    name: 'tSYNC', startTransitionIds: [startA.id, startB.id], endTransitionIds: [end.id]
  });

  assert.deepEqual(validateDocument(updated), { valid: true, errors: [], warnings: [] });
  assert.equal(getTransitionDependencies(updated, startB.id).timingParameters.length, 1);
});

test('rebinding to another slot resets only that endpoint to the dropped transition', () => {
  const { document, parameterId, newStart } = multiEndpointFixture();
  const previousEndIds = document.semantic.timingParameters[0].endTransitionIds;

  const updated = rebindTimingEndpoint(document, { parameterId, endpoint: 'start', transitionId: newStart.id });

  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, [newStart.id]);
  assert.deepEqual(updated.semantic.timingParameters[0].endTransitionIds, previousEndIds);
});

test('rebinding within the current slot preserves the selected subset', () => {
  const { document, parameterId, selectedStart } = multiEndpointFixture();
  const previousStartIds = document.semantic.timingParameters[0].startTransitionIds;

  const updated = rebindTimingEndpoint(document, { parameterId, endpoint: 'start', transitionId: selectedStart.id });

  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, previousStartIds);
});

test('moving one member moves every transition selected by the same timing endpoint', () => {
  const { document: initial, selectedStart } = multiEndpointFixture();
  const withExtraSignal = addSignal(initial, { name: 'UNRELATED#', type: 'control', initialState: 'HIGH' });
  const unrelatedSignal = withExtraSignal.semantic.signals.find((signal) => signal.name === 'UNRELATED#');
  const document = setSegmentBoundary(withExtraSignal, { signalId: unrelatedSignal.id, sequence: 10, rightState: 'LOW' });
  const selectedIds = document.semantic.timingParameters[0].startTransitionIds;
  const unrelatedTransition = transitionsAt(document, 10).find((transition) => transition.signalId === unrelatedSignal.id);

  const updated = moveTransition(document, { transitionId: selectedStart.id, targetSequence: 15 });

  const movedSequences = selectedIds.map((transitionId) => {
    const transition = updated.semantic.transitions.find((item) => item.id === transitionId);
    return updated.semantic.timeline.timeMarkers.find((marker) => marker.id === transition.markerId)?.sequence;
  });
  assert.deepEqual(movedSequences, [15, 15]);
  assert.equal(updated.semantic.timeline.timeMarkers.find((marker) => marker.id === updated.semantic.transitions.find((transition) => transition.id === unrelatedTransition.id).markerId).sequence, 10);
  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, selectedIds);
  assert.equal(validateDocument(updated).valid, true);
});

test('moving an overlapping timing endpoint moves its full connected selection', () => {
  const { document, weAt10, ceAt10, oeAt10 } = overlappingTimingEndpointFixture();

  const updated = moveTransition(document, { transitionId: weAt10.id, targetSequence: 15 });

  for (const transitionId of [weAt10.id, ceAt10.id, oeAt10.id]) {
    const transition = updated.semantic.transitions.find((item) => item.id === transitionId);
    const marker = updated.semantic.timeline.timeMarkers.find((item) => item.id === transition.markerId);
    assert.equal(marker.sequence, 15);
  }
  assert.equal(validateDocument(updated).valid, true);
});

test('rejecting an out-of-bounds connected timing move leaves the document untouched', () => {
  const { document, parameterId, selectedStart } = multiEndpointFixture();
  const annotated = addAnnotation(document, {
    text: 'do not detach', anchorType: 'timingParameter', anchorId: parameterId
  });
  const before = structuredClone(annotated);

  assert.throws(
    () => moveTransition(annotated, { transitionId: selectedStart.id, targetSequence: 35 }),
    /Transition must remain between its adjacent segment boundaries\./
  );

  assert.deepEqual(annotated, before);
});

test('rejecting a connected timing move onto the same signal leaves the document untouched', () => {
  const { document, selectedStart } = multiEndpointFixture();
  const before = structuredClone(document);

  assert.throws(
    () => moveTransition(document, { transitionId: selectedStart.id, targetSequence: 30 }),
    /A transition cannot merge with another transition from the same signal\./
  );

  assert.deepEqual(document, before);
});

test('moving a timing start past its end swaps endpoint direction', () => {
  const { document, startTransition, endTransition } = crossingRelationFixture();
  const withTiming = addTimingParameter(document, {
    name: 'tCROSS', startTransitionIds: [startTransition.id], endTransitionIds: [endTransition.id]
  });
  const parameterId = withTiming.semantic.timingParameters[0].id;
  const withTransitionNote = addAnnotation(withTiming, {
    text: 'edge note', anchorType: 'transition', anchorId: startTransition.id
  });
  const annotated = addAnnotation(withTransitionNote, {
    text: 'timing note', anchorType: 'timingParameter', anchorId: parameterId
  });

  const updated = moveTransition(annotated, { transitionId: startTransition.id, targetSequence: 25 });

  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, [endTransition.id]);
  assert.deepEqual(updated.semantic.timingParameters[0].endTransitionIds, [startTransition.id]);
  assert.deepEqual(updated.semantic.annotations.map((annotation) => [annotation.anchorType, annotation.anchorId]), [
    ['transition', startTransition.id],
    ['timingParameter', parameterId]
  ]);
  assert.deepEqual(updated.presentation.timingLaneOrder, [parameterId]);
  assert.equal(updated.presentation.timingParameterPositions[parameterId], 0.2);
  assert.equal(validateDocument(updated).valid, true);
});

test('rejecting a collapsed timing interval leaves the document untouched', () => {
  const { document, startTransition, endTransition } = crossingRelationFixture();
  const withTiming = addTimingParameter(document, {
    name: 'tCOLLAPSE', startTransitionIds: [startTransition.id], endTransitionIds: [endTransition.id]
  });
  const before = structuredClone(withTiming);

  assert.throws(
    () => moveTransition(withTiming, { transitionId: startTransition.id, targetSequence: 20 }),
    /Timing endpoints must be strictly left-to-right\./
  );

  assert.deepEqual(withTiming, before);
});

test('editing one timing endpoint member relocates its synchronous selection', () => {
  const { document, selectedStart } = multiEndpointFixture();
  const oe = document.semantic.signals.find((item) => item.name === 'OE#');
  const selectedIds = document.semantic.timingParameters[0].startTransitionIds;

  const updated = updateTransition(document, selectedStart.id, {
    signalId: oe.id,
    sequence: 15,
    rightState: 'UNKNOWN'
  });

  for (const transitionId of selectedIds) {
    const transition = updated.semantic.transitions.find((item) => item.id === transitionId);
    assert.equal(updated.semantic.timeline.timeMarkers.find((marker) => marker.id === transition.markerId).sequence, 15);
  }
  assert.equal(updated.semantic.transitions.find((item) => item.id === selectedStart.id).signalId, oe.id);
  assert.equal(updated.semantic.transitions.find((item) => item.id === selectedStart.id).toState, 'UNKNOWN');
  assert.equal(validateDocument(updated).valid, true);
});

test('reassigning one timing endpoint member to another signal at the same slot is allowed', () => {
  const { document, selectedStart } = multiEndpointFixture();
  const oe = document.semantic.signals.find((item) => item.name === 'OE#');

  const updated = updateTransition(document, selectedStart.id, {
    signalId: oe.id,
    sequence: 10,
    rightState: 'UNKNOWN'
  });

  assert.equal(updated.semantic.transitions.find((item) => item.id === selectedStart.id).signalId, oe.id);
  assert.equal(validateDocument(updated).valid, true);
});

test('moving the complete marker preserves a multi-member timing endpoint', () => {
  const { document, selectedStart } = multiEndpointFixture();
  const markerId = document.semantic.transitions.find((item) => item.id === selectedStart.id).markerId;

  const updated = moveMarker(document, { markerId, targetSequence: 15 });

  assert.equal(updated.semantic.timeline.timeMarkers.find((item) => item.sequence === 15).transitionIds.length, 2);
  assert.equal(validateDocument(updated).valid, true);
});

test('dependency lookup finds any member of a timing endpoint', () => {
  const { document } = multiEndpointFixture();
  const secondStart = document.semantic.timingParameters[0].startTransitionIds[1];

  const dependencies = getTransitionDependencies(document, secondStart);

  assert.deepEqual(dependencies.timingParameters.map((item) => item.name), ['tSYNC']);
  assert.equal(deleteTransitionWithDependencies(document, secondStart).deleted, false);
});

test('cascading one member from a multi-member endpoint retains the timing parameter', () => {
  const { document, selectedStart, parameterId } = multiEndpointFixture();
  const annotated = addAnnotation(document, {
    text: 'keep this parameter note', anchorType: 'timingParameter', anchorId: parameterId
  });

  const result = deleteTransitionWithDependencies(annotated, selectedStart.id, { cascade: true });

  assert.equal(result.deleted, true);
  assert.deepEqual(result.document.semantic.timingParameters[0].startTransitionIds, [
    annotated.semantic.timingParameters[0].startTransitionIds[1]
  ]);
  assert.equal(result.document.semantic.annotations.some((item) => item.anchorId === parameterId), true);
  assert.equal(result.document.presentation.timingLaneOrder.includes(parameterId), true);
  assert.equal(Number.isFinite(result.document.presentation.timingParameterPositions[parameterId]), true);
  assert.equal(validateDocument(result.document).valid, true);
});

test('cascading the last endpoint member removes the parameter and its presentation artifacts', () => {
  const { document, parameterId } = multiEndpointFixture();
  const endTransitionId = document.semantic.timingParameters[0].endTransitionIds[0];
  const annotated = addAnnotation(document, {
    text: 'remove this parameter note', anchorType: 'timingParameter', anchorId: parameterId
  });

  const result = deleteTransitionWithDependencies(annotated, endTransitionId, { cascade: true });

  assert.equal(result.deleted, true);
  assert.equal(result.document.semantic.timingParameters.length, 0);
  assert.equal(result.document.semantic.annotations.some((item) => item.anchorId === parameterId), false);
  assert.equal(result.document.presentation.timingLaneOrder.includes(parameterId), false);
  assert.equal(parameterId in result.document.presentation.timingParameterPositions, false);
  assert.equal(validateDocument(result.document).valid, true);
});

test('rejects invalid timing endpoint sets during creation and update', () => {
  const document = synchronousTwoSignalWaveform();
  const [startA, startB] = transitionsAt(document, 10);
  const [end] = transitionsAt(document, 30);

  assert.throws(() => addTimingParameter(document, {
    name: 'tDuplicate', startTransitionIds: [startA.id, startA.id], endTransitionIds: [end.id]
  }), /duplicate transitions/);
  assert.throws(() => addTimingParameter(document, {
    name: 'tCrossSlot', startTransitionIds: [startA.id, end.id], endTransitionIds: [end.id]
  }), /share one order slot/);
  assert.throws(() => addTimingParameter(document, {
    name: 'tEmpty', startTransitionIds: [], endTransitionIds: [end.id]
  }), /at least one transition/);
  assert.throws(() => addTimingParameter(document, {
    name: 'tDangling', startTransitionIds: ['tr_missing'], endTransitionIds: [end.id]
  }), /missing transition/);
  assert.throws(() => addTimingParameter(document, {
    name: 'tReversed', startTransitionIds: [end.id], endTransitionIds: [startB.id]
  }), /strictly left-to-right/);

  const valid = addTimingParameter(document, {
    name: 'tValid', startTransitionIds: [startA.id], endTransitionIds: [end.id]
  });
  assert.throws(() => updateTimingParameter(valid, valid.semantic.timingParameters[0].id, {
    startTransitionIds: [end.id], endTransitionIds: [startA.id]
  }), /strictly left-to-right/);
});

test('signal metadata and display order can change without changing semantic transitions', () => {
  const first = setupSignal('WE#');
  const withTwoSignals = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const updated = updateSignal(withTwoSignals, withTwoSignals.semantic.signals[0].id, { name: 'WEB#', subtype: 'write-enable', tags: ['active-low'] });
  const moved = moveSignalRow(updated, { signalId: updated.semantic.signals[0].id, targetIndex: 1 });

  assert.equal(moved.semantic.signals[0].name, 'WEB#');
  assert.deepEqual(moved.presentation.signalRowOrder, [updated.semantic.signals[1].id, updated.semantic.signals[0].id]);
});

test('moving a timing parameter vertically changes only its presentation position', () => {
  const initial = setupSignal();
  const signalId = initial.semantic.signals[0].id;
  const low = setSegmentBoundary(initial, { signalId, sequence: 10, rightState: 'LOW' });
  const high = setSegmentBoundary(low, { signalId, sequence: 30, rightState: 'HIGH' });
  const [startTransition, endTransition] = high.semantic.transitions;
  const withTiming = addTimingParameter(high, {
    name: 'tWP', startTransitionIds: [startTransition.id], endTransitionIds: [endTransition.id]
  });
  const parameterId = withTiming.semantic.timingParameters[0].id;

  const moved = setTimingParameterPosition(withTiming, { parameterId, position: 0.75 });

  assert.equal(moved.presentation.timingParameterPositions[parameterId], 0.75);
  assert.deepEqual(moved.semantic, withTiming.semantic);
  assert.deepEqual(withTiming.presentation.timingParameterPositions, { [parameterId]: 0.2 });
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
    name: 'tWP', startTransitionIds: [startTransition.id], endTransitionIds: [endTransition.id], requirementText: '>= 20 ns'
  });
  const withTransitionNote = addAnnotation(withTiming, { text: 'edge note', anchorType: 'transition', anchorId: startTransition.id });
  const withParameterNote = addAnnotation(withTransitionNote, { text: 'rule note', anchorType: 'timingParameter', anchorId: withTiming.semantic.timingParameters[0].id });
  const result = deleteTransitionWithDependencies(withParameterNote, startTransition.id, { cascade: true });

  assert.equal(result.document.semantic.annotations.length, 0);
  assert.deepEqual(result.document.presentation.timingParameterPositions, {});
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
