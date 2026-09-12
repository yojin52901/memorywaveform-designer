import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import { addPhase, addSignal, addTimingParameter, setPhasePosition, setSegmentBoundary, setTimingParameterPosition } from '../src/domain/operations.js';
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

function waveformWithTimingAndPhase() {
  const document = waveformWithTiming();
  const [startTransition, endTransition] = document.semantic.transitions;
  return addPhase(document, {
    name: 'write cycle',
    startTransitionId: startTransition.id,
    endTransitionId: endTransition.id
  });
}

function timingGroupFor(svg, parameterId) {
  return svg.match(new RegExp(`<g class="relation-lane timing"[^>]*data-relation-id="${parameterId}"[\\s\\S]*?</g>`))?.[0] ?? '';
}

function phaseGroupFor(svg, phaseId) {
  return svg.match(new RegExp(`<g class="relation-lane phase"[^>]*data-relation-id="${phaseId}"[\\s\\S]*?</g>`))?.[0] ?? '';
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

test('renders an UNKNOWN segment as a blue band with connected crosses touching both boundaries', () => {
  let document = addSignal(createDocument({ title: 'Unknown state' }), { name: 'DQ', type: 'data', initialState: 'HIGH' });
  const signalId = document.semantic.signals[0].id;
  document = setSegmentBoundary(document, { signalId, sequence: 10, rightState: 'UNKNOWN' });
  document = setSegmentBoundary(document, { signalId, sequence: 30, rightState: 'LOW' });
  const unknown = document.semantic.stateSegments.find((segment) => segment.state === 'UNKNOWN');
  const beforeRender = JSON.stringify(document);

  const svg = renderSvg(document);

  assert.doesNotMatch(svg, /unknown-hatch/);
  assert.match(svg, new RegExp(`class="state-unknown-band"[^>]*data-segment-id="${unknown.id}"[^>]*fill="#dbeafe"`));
  assert.match(svg, new RegExp(`class="state-unknown-band"[^>]*data-segment-id="${unknown.id}"[^>]*x="320"[^>]*width="150"`));
  assert.match(svg, new RegExp(`class="state-unknown-boundary top"[^>]*data-segment-id="${unknown.id}"[^>]*x1="320"[^>]*x2="470"[^>]*y1="92"[^>]*y2="92"`));
  assert.match(svg, new RegExp(`class="state-unknown-boundary bottom"[^>]*data-segment-id="${unknown.id}"[^>]*x1="320"[^>]*x2="470"[^>]*y1="116"[^>]*y2="116"`));
  const crosses = [...svg.matchAll(new RegExp(`<path class="state-unknown-cross" data-segment-id="${unknown.id}" d="([^"]+)"`, 'g'))].map((match) => match[1]);
  assert.deepEqual(crosses, [
    'M 323 92 L 347 116 M 347 92 L 323 116',
    'M 347 92 L 371 116 M 371 92 L 347 116',
    'M 371 92 L 395 116 M 395 92 L 371 116',
    'M 395 92 L 419 116 M 419 92 L 395 116',
    'M 419 92 L 443 116 M 443 92 L 419 116',
    'M 443 92 L 467 116 M 467 92 L 443 116'
  ]);
  assert.match(svg, /class="waveform-path"/);
  assert.equal(JSON.stringify(document), beforeRender);
});

test('a slot width override moves waveform, timing, and phase projections together', () => {
  const document = waveformWithTimingAndPhase();
  const beforeRender = JSON.stringify(document);
  const svg = renderSvg(document, { slotWidthUnits: { tm_start: 2 } });

  assert.match(svg, /data-slot-resize-start-marker-id="tm_start"/);
  assert.match(svg, /class="transition-target"[^>]*cx="470"/);
  assert.match(svg, /class="timing-connector start"[^>]*x1="470"[^>]*x2="470"/);
  assert.match(svg, /data-relation-kind="phase"[\s\S]*cx="470"/);
  assert.equal(JSON.stringify(document), beforeRender);
});

test('renders one top-ruler resize handle for every outgoing gap', () => {
  const document = waveformWithTiming();
  const [firstMarker, secondMarker] = document.semantic.timeline.timeMarkers;
  const svg = renderSvg(document);
  const handles = [...svg.matchAll(/<g class="slot-resize-handle"[^>]*>/g)].map((match) => match[0]);

  assert.equal(handles.length, 3);
  assert.match(handles[0], /data-slot-resize-start-marker-id="tm_start"/);
  assert.match(handles[0], /data-slot-start-x="170"/);
  assert.match(handles[0], /data-slot-width-units="1"/);
  assert.match(handles[1], new RegExp(`data-slot-resize-start-marker-id="${firstMarker.id}"`));
  assert.match(handles[2], new RegExp(`data-slot-resize-start-marker-id="${secondMarker.id}"`));
  assert.ok(svg.indexOf('class="slot-resize-handle"') > svg.indexOf('class="relation-lane timing"'));
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

test('renders a vertically positioned phase with connectors to both transition points', () => {
  const document = waveformWithTimingAndPhase();
  const phaseId = document.semantic.phases[0].id;
  const positioned = setPhasePosition(document, { phaseId, position: 0.25 });
  const phaseGroup = phaseGroupFor(renderSvg(positioned), phaseId);

  assert.match(phaseGroup, /data-relation-kind="phase"/);
  assert.match(phaseGroup, /data-phase-position="0.25"/);
  assert.match(phaseGroup, /data-relation-y="84"/);
  assert.match(phaseGroup, /class="phase-connector start"[^>]*x1="320"[^>]*x2="320"[^>]*y1="84"[^>]*y2="104"/);
  assert.match(phaseGroup, /class="phase-connector end"[^>]*x1="470"[^>]*x2="470"[^>]*y1="84"[^>]*y2="104"/);
  assert.match(phaseGroup, /class="relation-drag-target"/);
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

test('renders dark waveform paths, black timing connectors, and compact filled double arrows', () => {
  const svg = renderSvg(waveformWithTiming());

  assert.match(svg, /\.waveform-path\{(?=[^}]*stroke:#2a3038)[^}]*\}/);
  assert.match(svg, /\.relation-lane\.timing \.timing-connector\{(?=[^}]*stroke:#1c1f24)(?=[^}]*pointer-events:none)[^}]*\}/);
  assert.match(svg, /\.relation-lane\{color:#245c9f\}/);
  assert.match(svg, /<marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M 0 0 L 6 3 L 0 6 Z" fill="currentColor"\/><\/marker>/);
  assert.match(svg, /class="relation-arrow"[^>]*marker-start="url\(#arrow\)"[^>]*marker-end="url\(#arrow\)"/);
  assert.match(svg, /class="timing-connection-mark (?:start|end)"[^>]*fill="currentColor"/);
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
