import assert from 'node:assert/strict';
import test from 'node:test';

import { renderInspectorMarkup, resolveDropTransitionId, sequenceFromPointer } from '../src/ui/controller.js';
import { createDocument } from '../src/domain/document.js';
import { addAnnotation, addPhase, addSignal, addTimingParameter, setSegmentBoundary } from '../src/domain/operations.js';

test('relation drop resolution uses the element under the pointer, not the captured SVG target', () => {
  const target = { closest: (selector) => selector === '[data-transition-id]' ? { dataset: { transitionId: 'tr_target' } } : null };
  const root = { elementFromPoint: () => target };

  assert.equal(resolveDropTransitionId(root, 100, 80), 'tr_target');
});

test('dragging uses contiguous order slots starting at 1', () => {
  const svg = {
    getBoundingClientRect: () => ({ left: 0, width: 860 }),
    viewBox: { baseVal: { width: 860 } }
  };

  assert.equal(sequenceFromPointer(svg, { clientX: 320 }), 1);
  assert.equal(sequenceFromPointer(svg, { clientX: 470 }), 2);
});

test('the inspector exposes every field used to create waveform objects', () => {
  const withSignal = addSignal(createDocument({ title: 'Program' }), {
    name: 'WE#', type: 'control', initialState: 'HIGH', subtype: 'write-enable', tags: ['active-low']
  });
  const signalId = withSignal.semantic.signals[0].id;
  const withStart = setSegmentBoundary(withSignal, { signalId, sequence: 1, rightState: 'LOW' });
  const withEnd = setSegmentBoundary(withStart, { signalId, sequence: 2, rightState: 'HIGH' });
  const [start, end] = withEnd.semantic.transitions;
  const withTiming = addTimingParameter(withEnd, {
    name: 'tWP', startTransitionId: start.id, endTransitionId: end.id, requirementText: '>= 20 ns'
  });
  const withPhase = addPhase(withTiming, { name: 'Program', startTransitionId: start.id, endTransitionId: end.id, tags: ['write'] });
  const document = addAnnotation(withPhase, { text: 'active pulse', anchorType: 'signal', anchorId: signalId });

  const markup = renderInspectorMarkup(document, start.id);

  assert.match(markup, /name="initialState"/);
  assert.match(markup, /data-form="transition-edit"[\s\S]*name="signalId"/);
  assert.match(markup, /data-form="timing-edit"[\s\S]*name="requirementText"/);
  assert.match(markup, /data-form="phase-edit"[\s\S]*name="tags"/);
  assert.match(markup, /data-form="annotation-edit"[\s\S]*name="anchor"[\s\S]*name="text"/);
});
