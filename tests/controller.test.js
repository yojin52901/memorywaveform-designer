import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRelationEndpointDrop, bindCanvasPointerEvents, createEditor, pointerSvgY, relationEndpointUpdates, renderEditorMarkup, renderInspectorMarkup, renderPaletteMarkup, resolveDropTransitionId, sequenceFromPointer, timingEndpointIdsFromForm, timingEndpointSubmission, timingPositionFromPointer, transitionDependencyDeletePrompt } from '../src/ui/controller.js';
import { createDocument } from '../src/domain/document.js';
import { addAnnotation, addPhase, addSignal, addTimingParameter, moveSignalRow, setSegmentBoundary } from '../src/domain/operations.js';
import { renderSvg } from '../src/render/svg-renderer.js';
import { HISTORY_STORAGE_KEY } from '../src/ui/document-history.js';

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  };
}

function eventNode() {
  const listeners = new Map();
  return {
    innerHTML: '',
    value: '',
    disabled: false,
    textContent: '',
    className: '',
    classList: classList(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type, event) { listeners.get(type)?.(event); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(child) { return child; }
  };
}

function memoryStorage(payload) {
  const values = new Map(payload ? [[HISTORY_STORAGE_KEY, JSON.stringify(payload)]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

function fakeEditorRoot(historyPayload) {
  const elements = Object.fromEntries(['#palette', '#inspector', '#editor', '#document-status', '#export-json', '#export-png', '#import-json', '#new-document'].map((selector) => [selector, eventNode()]));
  const repairApply = eventNode();
  elements['#editor'].querySelector = (selector) => selector === '#repair-apply' ? repairApply : null;
  const body = eventNode();
  let notice = null;
  body.appendChild = (child) => {
    if (child.id === 'notice') notice = child;
    return child;
  };
  return {
    body,
    defaultView: { localStorage: memoryStorage(historyPayload) },
    querySelector: (selector) => selector === '#notice' ? notice : elements[selector] ?? null,
    createElement: () => eventNode(),
    elementFromPoint: () => null,
    elements
  };
}

function waveformWithTiming() {
  const withSignal = addSignal(createDocument({ title: 'Program' }), { name: 'WE#', type: 'control', initialState: 'HIGH' });
  const signalId = withSignal.semantic.signals[0].id;
  const low = setSegmentBoundary(withSignal, { signalId, sequence: 10, rightState: 'LOW' });
  const high = setSegmentBoundary(low, { signalId, sequence: 30, rightState: 'HIGH' });
  return addTimingParameter(high, {
    name: 'tWP',
    startTransitionIds: [high.semantic.transitions[0].id],
    endTransitionIds: [high.semantic.transitions[1].id]
  });
}

function historyPayload(activeDocument, otherDocument = null) {
  const entries = [{ id: 'active', title: activeDocument.metadata?.title ?? 'Broken', updatedAt: 2, snapshot: activeDocument }];
  if (otherDocument) entries.push({ id: 'other', title: otherDocument.metadata?.title ?? 'Broken', updatedAt: 1, snapshot: otherDocument });
  return { activeId: 'active', entries };
}

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

test('vertical timing drag maps the pointer into the signal overlay interval', () => {
  const svg = {
    dataset: { timingTopY: '64', timingBottomY: '144' },
    getBoundingClientRect: () => ({ top: 100, height: 500 }),
    viewBox: { baseVal: { height: 300 } }
  };

  assert.equal(timingPositionFromPointer(svg, { clientY: 100 }), 0);
  assert.ok(Math.abs(timingPositionFromPointer(svg, { clientY: 100 + (104 / 300) * 500 }) - 0.5) < 1e-12);
  assert.equal(timingPositionFromPointer(svg, { clientY: 600 }), 1);
});

test('timing drag preserves the pointer grab offset', () => {
  const svg = {
    dataset: { timingTopY: '64', timingBottomY: '144' },
    getBoundingClientRect: () => ({ top: 100, height: 400 }),
    viewBox: { baseVal: { height: 320 } }
  };
  const pointerY = pointerSvgY(svg, { clientY: 250 });
  const grabOffsetY = pointerY - 84;

  assert.equal(timingPositionFromPointer(svg, { clientY: 300 }, { grabOffsetY }), 0.75);
});

test('relation endpoint drags preserve timing arrays and phase singleton fields', () => {
  assert.deepEqual(relationEndpointUpdates('timing', 'start', 'tr_timing'), { startTransitionIds: ['tr_timing'] });
  assert.deepEqual(relationEndpointUpdates('timing', 'end', 'tr_timing'), { endTransitionIds: ['tr_timing'] });
  assert.deepEqual(relationEndpointUpdates('phase', 'start', 'tr_phase'), { startTransitionId: 'tr_phase' });
  assert.deepEqual(relationEndpointUpdates('phase', 'end', 'tr_phase'), { endTransitionId: 'tr_phase' });
});

test('timing endpoint drops preserve a same-slot selected transition subset', () => {
  let document = addSignal(createDocument({ title: 'Program' }), { name: 'WE#', type: 'control', initialState: 'HIGH' });
  document = addSignal(document, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const [we, ce] = document.semantic.signals;
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: ce.id, sequence: 10, rightState: 'LOW' });
  document = setSegmentBoundary(document, { signalId: we.id, sequence: 30, rightState: 'HIGH' });
  const startTransitions = document.semantic.transitions.filter((transition) => document.semantic.timeline.timeMarkers.find((marker) => marker.id === transition.markerId)?.sequence === 10);
  const endTransition = document.semantic.transitions.find((transition) => document.semantic.timeline.timeMarkers.find((marker) => marker.id === transition.markerId)?.sequence === 30);
  document = addTimingParameter(document, {
    name: 'tSYNC',
    startTransitionIds: startTransitions.map((transition) => transition.id),
    endTransitionIds: [endTransition.id]
  });

  const updated = applyRelationEndpointDrop(document, {
    relationKind: 'timing',
    relationId: document.semantic.timingParameters[0].id,
    endpoint: 'start',
    transitionId: startTransitions[1].id
  });

  assert.deepEqual(updated.semantic.timingParameters[0].startTransitionIds, startTransitions.map((transition) => transition.id));
});

test('timing endpoint editors render their selected same-slot transition subset as checkboxes', () => {
  const withWe = addSignal(createDocument({ title: 'Program' }), {
    name: 'WE#', type: 'control', initialState: 'HIGH'
  });
  const withSignals = addSignal(withWe, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const [weId, ceId] = withSignals.semantic.signals.map((signal) => signal.id);
  const withWeStart = setSegmentBoundary(withSignals, { signalId: weId, sequence: 10, rightState: 'LOW' });
  const withStarts = setSegmentBoundary(withWeStart, { signalId: ceId, sequence: 10, rightState: 'LOW' });
  const withEnd = setSegmentBoundary(withStarts, { signalId: weId, sequence: 30, rightState: 'HIGH' });
  const startTransitions = withEnd.semantic.transitions.filter((transition) => {
    const marker = withEnd.semantic.timeline.timeMarkers.find((item) => item.id === transition.markerId);
    return marker?.sequence === 10;
  });
  const end = withEnd.semantic.transitions.find((transition) => {
    const marker = withEnd.semantic.timeline.timeMarkers.find((item) => item.id === transition.markerId);
    return marker?.sequence === 30;
  });
  const document = addTimingParameter(withEnd, {
    name: 'tWP',
    startTransitionIds: startTransitions.map((transition) => transition.id),
    endTransitionIds: [end.id]
  });

  const markup = renderInspectorMarkup(document);
  const startGroup = markup.match(/<fieldset data-endpoint-group="start"[\s\S]*?<\/fieldset>/)?.[0] ?? '';
  const parameter = document.semantic.timingParameters[0];

  assert.match(markup, /data-endpoint-group="start"[\s\S]*Order slot #10/);
  assert.equal((startGroup.match(/name="startTransitionIds"[^>]*checked/g) ?? []).length, 2);
  assert.doesNotMatch(startGroup, /data-slot="30"/);
  assert.doesNotMatch(startGroup, /name="startTransitionIds"[^>]*required/);
  assert.match(startGroup, /WE# · HIGH→LOW/);
  assert.match(startGroup, /CE# · HIGH→LOW/);
  assert.match(startGroup, new RegExp(`aria-describedby="timing-endpoint-error-${parameter.id}-start"`));
  assert.match(startGroup, new RegExp(`<p class="field-error" id="timing-endpoint-error-${parameter.id}-start" role="alert"[^>]*data-endpoint-notice[^>]*hidden>`));
});

test('timing endpoint form values retain every selected checkbox value', () => {
  const formData = { getAll: (name) => name === 'startTransitionIds' ? ['tr_a', 'tr_b'] : [] };

  assert.deepEqual(timingEndpointIdsFromForm(formData, 'start'), ['tr_a', 'tr_b']);
});

test('timing endpoint submission accepts a non-first selected checkbox', () => {
  const formData = {
    getAll: (name) => name === 'startTransitionIds' ? ['tr_second'] : name === 'endTransitionIds' ? ['tr_end'] : []
  };

  assert.deepEqual(timingEndpointSubmission(formData), {
    shouldUpdate: true,
    startTransitionIds: ['tr_second'],
    endTransitionIds: ['tr_end'],
    errors: { start: '', end: '' }
  });
});

test('timing endpoint submission blocks document updates when an endpoint group is empty', () => {
  const formData = {
    getAll: (name) => name === 'startTransitionIds' ? [] : name === 'endTransitionIds' ? ['tr_end'] : []
  };

  assert.deepEqual(timingEndpointSubmission(formData), {
    shouldUpdate: false,
    startTransitionIds: [],
    endTransitionIds: ['tr_end'],
    errors: { start: 'Select at least one start transition.', end: '' }
  });
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
    name: 'tWP', startTransitionIds: [start.id], endTransitionIds: [end.id], requirementText: '>= 20 ns'
  });
  const withPhase = addPhase(withTiming, { name: 'Program', startTransitionId: start.id, endTransitionId: end.id, tags: ['write'] });
  const document = addAnnotation(withPhase, { text: 'active pulse', anchorType: 'signal', anchorId: signalId });

  const markup = renderInspectorMarkup(document, start.id);

  assert.match(markup, /name="initialState"/);
  assert.match(markup, /data-form="transition-edit"[\s\S]*name="signalId"/);
  assert.match(markup, /data-form="timing-edit"[\s\S]*name="requirementText"/);
  assert.doesNotMatch(markup, /name="requirementText"[^>]*required/);
  assert.match(markup, /Requirement note \(optional\)/);
  assert.doesNotMatch(markup, /Rule engine format|Rule status/);
  assert.match(markup, /data-form="phase-edit"[\s\S]*name="tags"/);
  assert.match(markup, /data-form="annotation-edit"[\s\S]*name="anchor"[\s\S]*name="text"/);
});

test('signal move controls follow the current presentation order', () => {
  const first = addSignal(createDocument({ title: 'Program' }), { name: 'WE#', type: 'control', initialState: 'HIGH' });
  const second = addSignal(first, { name: 'CE#', type: 'control', initialState: 'HIGH' });
  const weId = second.semantic.signals[0].id;
  const ceId = second.semantic.signals[1].id;
  const moved = moveSignalRow(second, { signalId: weId, targetIndex: 1 });

  const markup = renderInspectorMarkup(moved);
  const editors = [...markup.matchAll(/<form class="signal-editor"[\s\S]*?<\/form>/g)].map((match) => match[0]);
  const ceEditor = editors.find((editor) => editor.includes(`value="${ceId}"`)) ?? '';
  const weEditor = editors.find((editor) => editor.includes(`value="${weId}"`)) ?? '';

  assert.ok(markup.indexOf(`value="${ceId}"`) < markup.indexOf(`value="${weId}"`));
  assert.match(ceEditor, /data-signal-move="-1"[^>]*disabled/);
  assert.doesNotMatch(ceEditor, /data-signal-move="1"[^>]*disabled/);
  assert.doesNotMatch(weEditor, /data-signal-move="-1"[^>]*disabled/);
  assert.match(weEditor, /data-signal-move="1"[^>]*disabled/);
});

test('history and every authoring tool are independently collapsed by default', () => {
  const document = createDocument({ title: 'Program' });
  const history = {
    activeId: 'doc-1',
    entries: [{ id: 'doc-1', title: 'Program', updatedAt: 100, snapshot: document }]
  };

  const markup = renderPaletteMarkup({ documentModel: document, history, activeHistoryId: 'doc-1' });

  assert.match(markup, /<details class="history-disclosure">/);
  assert.doesNotMatch(markup, /<details class="history-disclosure" open/);
  assert.equal((markup.match(/<details class="tool-disclosure">/g) ?? []).length, 5);
  assert.doesNotMatch(markup, /<details class="tool-disclosure" open/);
  assert.match(markup, /data-history-id="doc-1"/);
});

test('a valid document can switch between waveform and formatted current JSON', () => {
  const document = createDocument({ title: 'Program' });
  const validation = { valid: true, errors: [], warnings: [] };

  const waveform = renderEditorMarkup(document, { mode: 'editor', validation, view: 'waveform' });
  const json = renderEditorMarkup(document, { mode: 'editor', validation, view: 'json' });

  assert.match(waveform, /data-editor-view="waveform"/);
  assert.match(waveform, /id="waveform-canvas"/);
  assert.match(json, /data-editor-view="json"/);
  assert.match(json, /id="document-json-view"/);
  assert.match(json, /&quot;title&quot;: &quot;Program&quot;/);
  assert.doesNotMatch(json, /id="waveform-canvas"/);
});

test('invalid and repair modes never expose the JSON projection switch', () => {
  const document = createDocument({ title: 'Program' });
  const invalid = renderEditorMarkup(document, { mode: 'editor', validation: { valid: false, errors: ['Broken'], warnings: [] }, view: 'json' });
  const repair = renderEditorMarkup(document, { mode: 'repair', validation: { valid: false, errors: ['Broken'], warnings: [] }, view: 'waveform', repairText: '{}' });

  assert.doesNotMatch(invalid, /data-editor-view=/);
  assert.match(invalid, /id="waveform-canvas"/);
  assert.doesNotMatch(repair, /data-editor-view=|id="waveform-canvas"/);
  assert.match(repair, /id="repair-json"/);
});

function renderedAttributes(markup) {
  return Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

function renderedDatasetFromAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes)
    .filter(([name]) => name.startsWith('data-'))
    .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value]));
}

test('timing drag surfaces must resolve to distinct rendered descendants', () => {
  const renderedSvg = renderSvg(waveformWithTiming())
    .replace('class="relation-drag-target"', 'class="relation-drag-target relation-arrow"')
    .replace('class="relation-arrow"', 'class="relation-arrow-red-proof"');

  assert.throws(
    () => renderedTimingContract({ renderedSvg }),
    /renderer must provide distinct timing drag surfaces/
  );
});

test('timing drag surface matching ignores data-class attributes', () => {
  const renderedSvg = renderSvg(waveformWithTiming())
    .replace('class="relation-arrow"', 'class="relation-arrow-red-proof" data-class="relation-arrow"');

  assert.throws(
    () => renderedTimingContract({ renderedSvg }),
    /renderer must provide exactly one timing .relation-arrow/
  );
});

test('timing drag contract rejects missing or renamed timing-group kind hooks before dispatch', () => {
  const renderedSvg = renderSvg(waveformWithTiming());
  const malformedGroups = [
    renderedSvg.replace(' data-relation-kind="timing"', ''),
    renderedSvg.replace('data-relation-kind="timing"', 'data-shadow-data-relation-kind="timing"')
  ];

  for (const malformedSvg of malformedGroups) {
    assert.throws(
      () => renderedTimingContract({ renderedSvg: malformedSvg }),
      /renderer must provide exactly one timing relation group/
    );
  }
});

function isRenderedTimingGroup(attributes) {
  return attributes['data-relation-kind'] === 'timing'
    && Object.prototype.hasOwnProperty.call(attributes, 'data-relation-id');
}

function renderedNode(candidate, timingGroup) {
  const { attributes, tagName } = candidate;
  const node = {
    className: attributes.class ?? '',
    dataset: renderedDatasetFromAttributes(attributes),
    tagName,
    closest(selector) {
      if (selector === '[data-relation-endpoint]' && node.dataset.relationEndpoint) return node;
      if (selector === '[data-relation-kind="timing"][data-relation-id]'
        && isRenderedTimingGroup(timingGroup.renderedAttributes)) return timingGroup;
      return null;
    }
  };
  return node;
}

function renderedTimingDescendants(markup) {
  return [...markup.matchAll(/<(?:line|circle)\b[^>]*\/>|<text\b[^>]*>[^<]*<\/text>/g)]
    .map((match, index) => ({
      attributes: renderedAttributes(match[0]),
      index,
      markup: match[0],
      tagName: /^<(\w+)/.exec(match[0])?.[1].toUpperCase() ?? ''
    }));
}

function hasRenderedClass(candidate, token) {
  return (candidate.attributes.class ?? '').split(/\s+/).includes(token);
}

function exactlyOneCandidate(candidates, selector, predicate) {
  const matches = candidates.filter(predicate);
  assert.equal(matches.length, 1, `renderer must provide exactly one timing ${selector}`);
  return matches[0];
}

function renderedTimingContract({ renderedSvg } = {}) {
  const document = waveformWithTiming();
  const groups = [...(renderedSvg ?? renderSvg(document)).matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)]
    .map((match) => ({
      attributes: renderedAttributes(match[0].match(/^<g\b[^>]*>/)?.[0] ?? ''),
      contents: match[2]
    }))
    .filter((group) => isRenderedTimingGroup(group.attributes));
  assert.equal(groups.length, 1, 'renderer must provide exactly one timing relation group');

  const { attributes: groupAttributes, contents: groupContents } = groups[0];
  const descendants = renderedTimingDescendants(groupContents);
  const timingGroup = {
    classList: classList(),
    dataset: renderedDatasetFromAttributes(groupAttributes),
    removeAttribute(name) { this.attributes.delete(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    attributes: new Map(),
    renderedAttributes: groupAttributes
  };
  const surfaceCandidates = [
    ['wide transparent line (.relation-drag-target)', '.relation-drag-target', (candidate) => hasRenderedClass(candidate, 'relation-drag-target')],
    ['visible arrow (.relation-arrow)', '.relation-arrow', (candidate) => hasRenderedClass(candidate, 'relation-arrow')],
    ['label (timing-group <text>)', '<text>', (candidate) => candidate.tagName === 'TEXT']
  ];
  const surfaces = surfaceCandidates.map(([name, selector, predicate]) => ({
    name,
    candidate: exactlyOneCandidate(descendants, selector, predicate)
  }));
  assert.equal(new Set(surfaces.map((surface) => surface.candidate.index)).size, surfaces.length, 'renderer must provide distinct timing drag surfaces');

  return {
    document,
    parameterId: timingGroup.dataset.relationId,
    startEndpoint: renderedNode(exactlyOneCandidate(descendants, 'start .relation-endpoint', (candidate) => hasRenderedClass(candidate, 'relation-endpoint') && candidate.attributes['data-relation-endpoint'] === 'start'), timingGroup),
    surfaces: surfaces.map(({ name, candidate }) => ({ name, node: renderedNode(candidate, timingGroup) })),
    timingGroup
  };
}

function timingDragHarness(contract, surface) {
  const { document, parameterId, timingGroup: group } = contract;
  const attributes = new Map();
  group.attributes = attributes;
  const svg = eventNode();
  svg.dataset = { timingTopY: '64', timingBottomY: '144' };
  svg.viewBox = { baseVal: { width: 860, height: 300 } };
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 860, height: 300 });
  svg.setPointerCapture = (pointerId) => { svg.capturedPointerId = pointerId; };
  svg.querySelector = (selector) => selector === `[data-relation-kind="timing"][data-relation-id="${parameterId}"]` ? group : null;
  svg.querySelectorAll = () => [];
  const status = eventNode();
  const editor = eventNode();
  editor.querySelector = (selector) => selector === '#drag-status' ? status : null;
  const state = { document, drag: null, relationCreation: null, selectedTransitionId: null };
  const notices = [];
  let renderCount = 0;
  bindCanvasPointerEvents(svg, {
    root: { elementFromPoint: () => null },
    editor,
    getState: () => state,
    applyOperation(operation) {
      state.document = operation(state.document);
      renderCount += 1;
    },
    setNotice: (notice) => notices.push(notice),
    render() {
      renderCount += 1;
      group.removeAttribute('transform');
    },
    showDragFeedback: () => {},
    clearDragFeedback: () => {},
    dragMessage: (_drag, position) => `position:${position}`
  });
  const pointer = (clientY) => ({
    target: surface,
    pointerId: 7,
    clientX: 320,
    clientY,
    preventDefault() {},
    stopPropagation() {}
  });
  return { attributes, group, notices, parameterId, pointer, renderCount: () => renderCount, state, surface, svg };
}

test('createEditor timing drag lifecycle commits the final preview from each rendered timing surface', () => {
  const contract = renderedTimingContract();

  for (const surface of contract.surfaces) {
    const harness = timingDragHarness(contract, surface.node);

    harness.svg.dispatch('pointerdown', harness.pointer(80));
    const documentBeforeMove = structuredClone(harness.state.document);
    harness.svg.dispatch('pointermove', harness.pointer(124));

    assert.equal(harness.state.drag.kind, 'timing-position');
    assert.equal(harness.svg.capturedPointerId, 7);
    assert.equal(harness.attributes.get('transform'), 'translate(0 44)');
    assert.deepEqual(harness.state.document, documentBeforeMove);

    harness.svg.dispatch('pointerup', harness.pointer(140));

    assert.equal(harness.state.drag, null);
    assert.equal(harness.state.document.presentation.timingParameterPositions[harness.parameterId], 0.75);
    assert.equal(harness.renderCount(), 1);
  }
});

test('createEditor timing drag cancellation restores the render without mutating position', () => {
  const contract = renderedTimingContract();
  const harness = timingDragHarness(contract, contract.surfaces.find((surface) => surface.name.startsWith('label'))?.node);
  const before = structuredClone(harness.state.document);

  harness.svg.dispatch('pointerdown', harness.pointer(80));
  harness.svg.dispatch('pointermove', harness.pointer(124));
  harness.svg.dispatch('pointercancel', harness.pointer(124));

  assert.deepEqual(harness.state.document, before);
  assert.equal(harness.state.drag, null);
  assert.equal(harness.attributes.has('transform'), false);
  assert.deepEqual(harness.notices, ['Drag cancelled.']);
  assert.equal(harness.renderCount(), 1);
});

test('relation endpoints retain pointerdown priority over their timing group', () => {
  const contract = renderedTimingContract();
  const harness = timingDragHarness(contract, contract.startEndpoint);

  harness.svg.dispatch('pointerdown', harness.pointer(80));

  assert.deepEqual(harness.state.drag, {
    kind: 'relation-endpoint', relationId: harness.parameterId, relationKind: 'timing', endpoint: 'start'
  });
});

for (const [name, invalidDocument] of [
  ['malformed known 1.0', { schemaVersion: '1.0', metadata: { title: 'Broken legacy' }, semantic: { timeline: {} }, presentation: {} }],
  ['unknown-version', { ...waveformWithTiming(), schemaVersion: '2.0' }]
]) {
  test(`startup opens ${name} history in repair mode and preserves history access`, () => {
    const root = fakeEditorRoot(historyPayload(invalidDocument));
    let instance;

    assert.doesNotThrow(() => { instance = createEditor(root); });

    const state = instance.getState();
    assert.equal(state.mode, 'repair');
    assert.equal(state.validation.valid, false);
    assert.equal(state.history.entries.length, 1);
    assert.equal(state.history.activeId, 'active');
    assert.match(state.repairText, /schemaVersion/);
    assert.match(root.elements['#palette'].innerHTML, /data-history-id="active"/);
    assert.doesNotMatch(root.elements['#editor'].innerHTML, /id="waveform-canvas"/);
  });
}

for (const [name, invalidDocument] of [
  ['malformed known 1.0', { schemaVersion: '1.0', metadata: { title: 'Broken legacy' }, semantic: { timeline: {} }, presentation: {} }],
  ['unknown-version', { ...waveformWithTiming(), schemaVersion: '2.0' }]
]) {
  test(`history selection opens ${name} snapshot in repair mode and can switch back`, () => {
    const valid = waveformWithTiming();
    const root = fakeEditorRoot(historyPayload(valid, invalidDocument));
    const instance = createEditor(root);
    const clickHistory = (id) => root.elements['#palette'].dispatch('click', {
      target: { closest: (selector) => selector === '[data-history-id]' ? { dataset: { historyId: id } } : null }
    });

    assert.doesNotThrow(() => clickHistory('other'));
    assert.equal(instance.getState().mode, 'repair');
    assert.equal(instance.getState().history.entries.length, 2);
    assert.match(root.elements['#palette'].innerHTML, /data-history-id="active"/);

    clickHistory('active');
    assert.equal(instance.getState().mode, 'editor');
    assert.equal(instance.getState().validation.valid, true);
  });
}

test('repair rendering keeps malformed collections inspectable across startup and history selection', () => {
  const malformed = waveformWithTiming();
  malformed.semantic.signals = {};
  malformed.semantic.stateSegments = null;
  malformed.semantic.transitions = 'broken';
  malformed.semantic.timingParameters = {};
  malformed.semantic.phases = 1;
  malformed.semantic.annotations = false;

  const startupRoot = fakeEditorRoot(historyPayload(malformed));
  let startup;
  assert.doesNotThrow(() => { startup = createEditor(startupRoot); });
  assert.equal(startup.getState().mode, 'repair');
  assert.match(startupRoot.elements['#palette'].innerHTML, /data-history-id="active"/);
  assert.match(startupRoot.elements['#editor'].innerHTML, /&quot;signals&quot;: \{\}/);
  assert.doesNotThrow(() => startupRoot.elements['#inspector'].dispatch('click', { target: { dataset: { repairObject: 'signals' } } }));
  assert.match(startupRoot.elements['#inspector'].innerHTML, /<pre class="repair-properties">\{\}<\/pre>/);
  startupRoot.elements['#inspector'].dispatch('click', { target: { dataset: { repairObject: 'stateSegments' } } });
  assert.match(startupRoot.elements['#inspector'].innerHTML, /<pre class="repair-properties">null<\/pre>/);

  const selectionRoot = fakeEditorRoot(historyPayload(waveformWithTiming(), malformed));
  const selection = createEditor(selectionRoot);
  assert.doesNotThrow(() => selectionRoot.elements['#palette'].dispatch('click', {
    target: { closest: (selector) => selector === '[data-history-id]' ? { dataset: { historyId: 'other' } } : null }
  }));
  assert.equal(selection.getState().mode, 'repair');
  assert.match(selectionRoot.elements['#palette'].innerHTML, /data-history-id="active"/);
  assert.match(selectionRoot.elements['#editor'].innerHTML, /&quot;transitions&quot;: &quot;broken&quot;/);
});

test('cascade confirmation accurately says dependent objects may be updated or removed', () => {
  const prompt = transitionDependencyDeletePrompt('tSYNC, Program');

  assert.match(prompt, /updated or removed as required/);
  assert.doesNotMatch(prompt, /delete the transition and these dependent objects/i);
});
