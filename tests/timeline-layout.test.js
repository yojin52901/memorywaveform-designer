import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocument } from '../src/domain/document.js';
import { addSignal, setSegmentBoundary } from '../src/domain/operations.js';
import { createTimelineLayout } from '../src/render/timeline-layout.js';

function waveformWithTwoMarkers() {
  const withSignal = addSignal(createDocument({ title: 'Program' }), {
    name: 'WE#', type: 'control', initialState: 'HIGH'
  });
  const signalId = withSignal.semantic.signals[0].id;
  const low = setSegmentBoundary(withSignal, { signalId, sequence: 10, rightState: 'LOW' });
  return setSegmentBoundary(low, { signalId, sequence: 30, rightState: 'HIGH' });
}

test('timeline layout defaults every gap to one unit', () => {
  const document = waveformWithTwoMarkers();
  const [firstMarker, secondMarker] = document.semantic.timeline.timeMarkers;
  const layout = createTimelineLayout(document);

  assert.equal(layout.markerX.get(firstMarker.id), 320);
  assert.equal(layout.markerX.get(secondMarker.id), 470);
  assert.equal(layout.endX, 620);
});

test('a widened leading gap shifts all later markers without changing their sequence', () => {
  const document = waveformWithTwoMarkers();
  const [firstMarker, secondMarker] = document.semantic.timeline.timeMarkers;
  const layout = createTimelineLayout(document, { slotWidthUnits: { tm_start: 2 } });

  assert.equal(layout.markerX.get(firstMarker.id), 470);
  assert.equal(layout.markerX.get(secondMarker.id), 620);
  assert.deepEqual(document.semantic.timeline.timeMarkers.map((marker) => marker.sequence), [10, 30]);
});

test('a partial transient override preserves persisted widths for other gaps', () => {
  const document = waveformWithTwoMarkers();
  const [firstMarker, secondMarker] = document.semantic.timeline.timeMarkers;
  document.presentation.slotWidthUnits = { [firstMarker.id]: 2 };

  const layout = createTimelineLayout(document, { slotWidthUnits: { tm_start: 2 } });

  assert.equal(layout.markerX.get(firstMarker.id), 470);
  assert.equal(layout.markerX.get(secondMarker.id), 770);
  assert.equal(document.presentation.slotWidthUnits.tm_start, undefined);
});

test('legacy documents retain equal-width terminal geometry', () => {
  const document = waveformWithTwoMarkers();
  delete document.presentation.slotWidthUnits;

  const layout = createTimelineLayout(document);

  assert.equal(layout.gaps.at(-1).startMarkerId, document.semantic.timeline.timeMarkers[1].id);
  assert.equal(layout.gaps.at(-1).endMarkerId, document.semantic.timeline.endMarkerId);
  assert.equal(layout.gaps.at(-1).widthUnits, 1);
  assert.equal(layout.slotCoordinateForX(545), 2.5);
});

test('timeline layout normalizes invalid persisted and transient slot widths', () => {
  const cases = [
    { persistedWidth: 0, transientWidth: undefined, expectedWidth: 0.4, expectedMarkerX: 230 },
    { persistedWidth: Infinity, transientWidth: undefined, expectedWidth: 1, expectedMarkerX: 320 },
    { persistedWidth: undefined, transientWidth: 5, expectedWidth: 4, expectedMarkerX: 770 }
  ];

  for (const { persistedWidth, transientWidth, expectedWidth, expectedMarkerX } of cases) {
    const document = waveformWithTwoMarkers();
    const [firstMarker] = document.semantic.timeline.timeMarkers;
    document.presentation.slotWidthUnits = persistedWidth === undefined ? {} : { tm_start: persistedWidth };
    const layout = createTimelineLayout(document, {
      slotWidthUnits: transientWidth === undefined ? {} : { tm_start: transientWidth }
    });

    assert.equal(layout.gaps[0].widthUnits, expectedWidth);
    assert.equal(layout.markerX.get(firstMarker.id), expectedMarkerX);
    assert.equal(Number.isFinite(layout.endX), true);
  }
});
