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
    startTransitionIds: [high.semantic.transitions[0].id],
    endTransitionIds: [high.semantic.transitions[1].id],
    requirementText: '>= 20 ns'
  });
}

function timingGroupFor(svg, parameterId) {
  return svg.match(new RegExp(`<g class="relation-lane timing"[^>]*data-relation-id="${parameterId}"[\\s\\S]*?</g>`))?.[0] ?? '';
}

function connectorTargetYs(group) {
  return new Set([...group.matchAll(/class="timing-connector (?:start|end)"[^>]*y2="([\d.]+)"/g)].map((match) => Number(match[1])));
}

function connectorXs(group, endpoint) {
  return new Set([...group.matchAll(new RegExp(`class="timing-connector ${endpoint}"[^>]*x1="([\\d.]+)"`, 'g'))].map((match) => Number(match[1])));
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
  const positioned = setTimingParameterPosition(document, { parameterId, position: 0.333333 });
  const svg = renderSvg(positioned);
  const timingGroup = svg.match(new RegExp(`<g class="relation-lane timing"[^>]*data-relation-id="${parameterId}"[\\s\\S]*?</g>`))?.[0] ?? '';
  const y = Number(timingGroup.match(/data-relation-y="([\d.]+)"/)?.[1]);

  assert.match(timingGroup, /data-relation-kind="timing"/);
  assert.match(timingGroup, /data-timing-position="0.333333"/);
  assert.match(timingGroup, /class="relation-drag-target"/);
  assert.equal(y, 90.66664);
  assert.ok(y >= 60 && y <= 150, `expected timing y inside the signal plot, received ${y}`);
  assert.ok(svg.indexOf('class="signal-row"') < svg.indexOf('class="relation-lane timing"'));
});

test('renders connectors and connection marks for every timing endpoint member', () => {
  let document = addSignal(createDocument({ title: 'Program' }), { name: 'WE#', type: 'control', initialState: 'HIGH' });
  const firstSignalId = document.semantic.signals[0].id;
  document = setSegmentBoundary(document, { signalId: firstSignalId, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: firstSignalId, sequence: 30, rightState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const secondSignalId = document.semantic.signals[1].id;
  document = setSegmentBoundary(document, { signalId: secondSignalId, sequence: 10, rightState: 'LOW' });

  const startA = document.semantic.transitions.find((transition) => transition.signalId === firstSignalId && transition.fromState === 'HIGH');
  const startB = document.semantic.transitions.find((transition) => transition.signalId === secondSignalId);
  const end = document.semantic.transitions.find((transition) => transition.signalId === firstSignalId && transition.fromState === 'LOW');
  document = addTimingParameter(document, {
    name: 'tWP',
    startTransitionIds: [startA.id, startB.id],
    endTransitionIds: [end.id],
    requirementText: '>= 20 ns'
  });
  document.presentation.signalRowOrder = [secondSignalId, firstSignalId];

  const parameter = document.semantic.timingParameters[0];
  const svg = renderSvg(document);
  const timingGroup = timingGroupFor(svg, parameter.id);

  assert.equal((timingGroup.match(/class="timing-connector start"/g) ?? []).length, 2);
  assert.equal((timingGroup.match(/class="timing-connector end"/g) ?? []).length, 1);
  assert.equal((timingGroup.match(/class="timing-connection-mark start"/g) ?? []).length, 2);
  assert.equal((timingGroup.match(/class="timing-connection-mark end"/g) ?? []).length, 1);
  assert.equal((timingGroup.match(/class="timing-connection-mark start"[^>]*fill="currentColor"/g) ?? []).length, 2);
  assert.equal((timingGroup.match(/class="timing-connection-mark end"[^>]*fill="currentColor"/g) ?? []).length, 1);
  assert.match(timingGroup, new RegExp(`data-transition-id="${startA.id}"`));
  assert.match(timingGroup, new RegExp(`data-transition-id="${startB.id}"`));
  assert.equal(connectorXs(timingGroup, 'start').size, 1);
  assert.deepEqual(connectorTargetYs(timingGroup), new Set([104, 198]));
  assert.match(timingGroup, new RegExp(`class="timing-connector start"[^>]*data-transition-id="${startA.id}"[^>]*y2="198"`));
  assert.match(timingGroup, new RegExp(`class="timing-connector start"[^>]*data-transition-id="${startB.id}"[^>]*y2="104"`));
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
