import assert from 'node:assert/strict';
import test from 'node:test';

import { renderEditorMarkup, renderInspectorMarkup, renderPaletteMarkup, resolveDropTransitionId, sequenceFromPointer, timingPositionFromPointer } from '../src/ui/controller.js';
import { createDocument } from '../src/domain/document.js';
import { addAnnotation, addPhase, addSignal, addTimingParameter, moveSignalRow, setSegmentBoundary } from '../src/domain/operations.js';

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
  assert.equal(timingPositionFromPointer(svg, { clientY: 100 + (104 / 300) * 500 }), 0.5);
  assert.equal(timingPositionFromPointer(svg, { clientY: 600 }), 1);
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
