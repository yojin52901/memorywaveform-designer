import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import { addSignal, addTimingParameter, setSegmentBoundary } from '../src/domain/operations.js';
import { renderSvg } from '../src/render/svg-renderer.js';

function waveformWithTiming() {
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

test('renders state paths, selectable transitions, timing lanes, and no semantic pixels', () => {
  const document = waveformWithTiming();
  const svg = renderSvg(document, { draft: false });

  assert.match(svg, /data-transition-id="tr_/);
  assert.match(svg, /data-relation-id="tp_/);
  assert.match(svg, /tWP/);
  assert.doesNotMatch(svg, /DRAFT \/ INVALID/);
  assert.doesNotMatch(JSON.stringify(document), /"x"\s*:/);
});

test('renders a clear draft watermark only when requested', () => {
  const document = waveformWithTiming();

  assert.match(renderSvg(document, { draft: true }), /DRAFT \/ INVALID/);
});

test('appends semantic signals that presentation order omitted', () => {
  const first = waveformWithTiming();
  const withSecondSignal = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  withSecondSignal.presentation.signalRowOrder = [withSecondSignal.semantic.signals[0].id];

  const svg = renderSvg(withSecondSignal);
  assert.match(svg, new RegExp(`data-signal-id="${withSecondSignal.semantic.signals[0].id}"`));
  assert.match(svg, new RegExp(`data-signal-id="${withSecondSignal.semantic.signals[1].id}"`));
});
