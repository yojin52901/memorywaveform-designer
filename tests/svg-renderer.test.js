import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import { addSignal, addTimingParameter, setSegmentBoundary, setTimingParameterPosition } from '../src/domain/operations.js';
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

test('renders a vertically positioned timing parameter over the signal layer', () => {
  const document = waveformWithTiming();
  const parameterId = document.semantic.timingParameters[0].id;
  const positioned = setTimingParameterPosition(document, { parameterId, position: 0.75 });
  const svg = renderSvg(positioned);
  const timingGroup = svg.match(new RegExp(`<g class="relation-lane timing"[^>]*data-relation-id="${parameterId}"[\\s\\S]*?</g>`))?.[0] ?? '';
  const y = Number(timingGroup.match(/data-relation-y="([\d.]+)"/)?.[1]);

  assert.match(timingGroup, /data-relation-kind="timing"/);
  assert.match(timingGroup, /data-timing-position="0.75"/);
  assert.match(timingGroup, /class="relation-drag-target"/);
  assert.ok(y >= 60 && y <= 150, `expected timing y inside the signal plot, received ${y}`);
  assert.ok(svg.indexOf('class="signal-row"') < svg.indexOf('class="relation-lane timing"'));
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
