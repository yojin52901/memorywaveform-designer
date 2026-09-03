import { BASE_SLOT_WIDTH, SLOT_WIDTH_UNIT_MAX, SLOT_WIDTH_UNIT_MIN } from '../domain/constants.js';

const LEFT_X = 170;

function normalizedWidthUnits(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(SLOT_WIDTH_UNIT_MIN, Math.min(SLOT_WIDTH_UNIT_MAX, value));
}

export function createTimelineLayout(document, { slotWidthUnits = {} } = {}) {
  const timeline = document.semantic.timeline;
  const markers = [...timeline.timeMarkers].sort((left, right) => left.sequence - right.sequence);
  const boundaries = [
    timeline.startMarkerId,
    ...markers.map((marker) => marker.id),
    timeline.endMarkerId
  ];
  const persistedWidths = document.presentation?.slotWidthUnits ?? {};
  const resolvedWidths = { ...persistedWidths, ...slotWidthUnits };
  const markerX = new Map();
  const gaps = [];
  let x = LEFT_X;

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMarkerId = boundaries[index];
    const endMarkerId = boundaries[index + 1];
    const widthUnits = normalizedWidthUnits(resolvedWidths[startMarkerId] ?? 1);
    const startX = x;
    const endX = startX + BASE_SLOT_WIDTH * widthUnits;
    gaps.push({ startMarkerId, endMarkerId, startX, endX, widthUnits });
    if (endMarkerId !== timeline.endMarkerId) markerX.set(endMarkerId, endX);
    x = endX;
  }

  const endX = x;
  return {
    leftX: LEFT_X,
    endX,
    width: Math.max(860, endX + 80),
    markerX,
    gaps,
    slotCoordinateForX(xCoordinate) {
      const gapIndex = gaps.findIndex((gap) => xCoordinate <= gap.endX);
      const index = gapIndex === -1 ? gaps.length - 1 : gapIndex;
      const gap = gaps[index];
      return index + (xCoordinate - gap.startX) / (gap.endX - gap.startX);
    }
  };
}
