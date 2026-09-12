import { createDocument } from './document.js';
import { addAnnotation, addPhase, addSignal, addTimingParameter, setPhasePosition, setSegmentBoundary, setTimingParameterPosition } from './operations.js';

// A fixed, bundled example. Each opening builds an independent editable document.
export function createExampleDocument() {
  let document = createDocument({ title: 'Example document — ENVM power-on, write & power-off' });
  document.metadata = {
    ...document.metadata,
    operation: 'Power-on / write / power-off',
    memoryTechnology: 'ENVM (illustrative)',
    description: 'Built-in example demonstrating signal transitions, timing relationships and phases. Order slots are illustrative, not a device timing specification.',
    tags: ['example', 'power-sequence', 'write']
  };
  const signals = [
    ['VDD', 'power', 'LOW', [[1, 'HIGH'], [8, 'LOW']]],
    ['RESET_N', 'control', 'LOW', [[2, 'HIGH'], [7, 'LOW']]],
    ['CE_N', 'control', 'HIGH', [[3, 'LOW'], [6, 'HIGH']]],
    ['WE_N', 'control', 'HIGH', [[4, 'LOW'], [5, 'HIGH']]],
    ['ADDR_VALID', 'control', 'LOW', [[3, 'HIGH'], [6, 'LOW']]],
    ['DQ', 'data', 'UNKNOWN', [[4, 'HIGH'], [6, 'UNKNOWN']]]
  ];
  for (const [name, type, initialState, boundaries] of signals) {
    document = addSignal(document, { name, type, initialState });
    const signalId = document.semantic.signals.at(-1).id;
    for (const [sequence, rightState] of boundaries) {
      document = setSegmentBoundary(document, { signalId, sequence, rightState });
    }
  }
  const transition = (name, slot) => {
    const signalId = document.semantic.signals.find((signal) => signal.name === name).id;
    const markerId = document.semantic.timeline.timeMarkers.find((marker) => marker.sequence === slot).id;
    return document.semantic.transitions.find((item) => item.signalId === signalId && item.markerId === markerId).id;
  };
  const timings = [
    ['tPOR', [['VDD', 1]], [['RESET_N', 2]], 'Power is established before reset release.', 0.04],
    ['tSETUP', [['CE_N', 3], ['ADDR_VALID', 3]], [['WE_N', 4]], 'Chip select and address-valid share the setup start slot.', 0.34],
    ['tWP', [['WE_N', 4]], [['WE_N', 5]], 'Active-low write pulse width.', 0.55],
    ['tDH', [['WE_N', 5]], [['DQ', 6]], 'Data remains valid after write-enable is released.', 0.78],
    ['tOFF', [['RESET_N', 7]], [['VDD', 8]], 'Reset is asserted before power removal.', 0.14]
  ];
  for (const [name, start, end, requirementText, position] of timings) {
    document = addTimingParameter(document, {
      name,
      startTransitionIds: start.map(([signal, slot]) => transition(signal, slot)),
      endTransitionIds: end.map(([signal, slot]) => transition(signal, slot)),
      requirementText
    });
    document = setTimingParameterPosition(document, { parameterId: document.semantic.timingParameters.at(-1).id, position });
  }
  for (const [name, start, end, position] of [
    ['Power-on', ['VDD', 1], ['CE_N', 3], 0.2],
    ['Write', ['CE_N', 3], ['CE_N', 6], 0.92],
    ['Power-off', ['CE_N', 6], ['VDD', 8], 0.25]
  ]) {
    document = addPhase(document, { name, startTransitionId: transition(...start), endTransitionId: transition(...end) });
    document = setPhasePosition(document, { phaseId: document.semantic.phases.at(-1).id, position });
  }
  return addAnnotation(document, { text: 'Illustrative example only — order slots and timing notes are not device specifications.' });
}
