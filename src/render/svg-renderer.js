import { createTimelineLayout } from './timeline-layout.js';

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function segmentsForSignal(document, signalId, markerX, leftX, endX) {
  const sequenceFor = (markerId) => {
    if (markerId === document.semantic.timeline.startMarkerId) return Number.NEGATIVE_INFINITY;
    if (markerId === document.semantic.timeline.endMarkerId) return Number.POSITIVE_INFINITY;
    return document.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId)?.sequence ?? Number.NaN;
  };
  return document.semantic.stateSegments
    .filter((segment) => segment.signalId === signalId)
    .sort((left, right) => sequenceFor(left.startMarkerId) - sequenceFor(right.startMarkerId))
    .map((segment) => ({
      ...segment,
      startX: segment.startMarkerId === document.semantic.timeline.startMarkerId ? leftX : markerX.get(segment.startMarkerId),
      endX: segment.endMarkerId === document.semantic.timeline.endMarkerId ? endX : markerX.get(segment.endMarkerId)
    }));
}

function stateY(baseY, state) {
  if (state === 'HIGH') return baseY - 20;
  if (state === 'LOW') return baseY + 20;
  return baseY;
}

function stateClass(state) {
  return state === 'UNKNOWN' ? 'state-unknown' : state === 'UNSPECIFIED' ? 'state-unspecified' : 'state-known';
}

function relationItems(document, kind) {
  const source = kind === 'timing' ? document.semantic.timingParameters : document.semantic.phases;
  const relations = new Map(source.map((item) => [item.id, { ...item, kind }]));
  const orderedIds = document.presentation?.timingLaneOrder ?? [];
  const ordered = orderedIds.map((id) => relations.get(id)).filter(Boolean);
  const remaining = [...relations.values()].filter((item) => !orderedIds.includes(item.id));
  return [...ordered, ...remaining];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function renderSvg(document, { draft = false, slotWidthUnits, includeSignalLabels = true, timelineLeftX, minimumWidth } = {}) {
  const signalsById = new Map(document.semantic.signals.map((signal) => [signal.id, signal]));
  const presentedSignalIds = document.presentation?.signalRowOrder?.filter((id) => signalsById.has(id)) ?? [];
  const signalIds = [
    ...presentedSignalIds,
    ...document.semantic.signals.map((signal) => signal.id).filter((id) => !presentedSignalIds.includes(id))
  ];
  const markers = [...document.semantic.timeline.timeMarkers].sort((left, right) => left.sequence - right.sequence);
  const layout = createTimelineLayout(document, {
    slotWidthUnits,
    leftX: timelineLeftX,
    minimumWidth
  });
  const { leftX, endX, width, markerX } = layout;
  const timingList = relationItems(document, 'timing');
  const phaseList = relationItems(document, 'phase');
  const signalHeight = Math.max(1, signalIds.length) * 94;
  const timingTopY = 64;
  const timingBottomY = 104 + (Math.max(1, signalIds.length) - 1) * 94 + 40;
  const height = Math.max(300, timingBottomY + 66 + document.semantic.annotations.length * 18);
  const transitionById = new Map(document.semantic.transitions.map((transition) => [transition.id, transition]));
  const signalYById = new Map(signalIds.map((signalId, index) => [signalId, 104 + index * 94]));

  const rows = signalIds.map((signalId) => {
    const signal = signalsById.get(signalId);
    const baseY = signalYById.get(signalId);
    const segments = segmentsForSignal(document, signalId, markerX, leftX, endX);
    const path = segments.reduce((parts, segment, segmentIndex) => {
      const segmentStartX = segmentIndex === 0 ? leftX : markerX.get(segment.startMarkerId);
      const y = stateY(baseY, segment.state);
      if (segmentIndex === 0) parts.push(`M ${segmentStartX} ${y}`);
      parts.push(`L ${segment.endX} ${y}`);
      const next = segments[segmentIndex + 1];
      if (next) parts.push(`L ${segment.endX} ${stateY(baseY, next.state)}`);
      return parts;
    }, []).join(' ');
    const unknownBands = segments.filter((segment) => segment.state === 'UNKNOWN').map((segment) =>
      `<rect class="state-unknown-band" data-segment-id="${escapeXml(segment.id)}" x="${segment.startX}" y="${baseY - 12}" width="${segment.endX - segment.startX}" height="24" fill="#dbeafe"><title>UNKNOWN state</title></rect>`
    ).join('');
    const unknownBoundaries = segments.filter((segment) => segment.state === 'UNKNOWN').map((segment) =>
      `<line class="state-unknown-boundary top" data-segment-id="${escapeXml(segment.id)}" x1="${segment.startX}" x2="${segment.endX}" y1="${baseY - 12}" y2="${baseY - 12}"/><line class="state-unknown-boundary bottom" data-segment-id="${escapeXml(segment.id)}" x1="${segment.startX}" x2="${segment.endX}" y1="${baseY + 12}" y2="${baseY + 12}"/>`
    ).join('');
    const unknownCrosses = segments.filter((segment) => segment.state === 'UNKNOWN').map((segment) => {
      const crossSize = 24;
      const crossStride = 24;
      const segmentWidth = segment.endX - segment.startX;
      const count = Math.max(1, Math.floor((segmentWidth - crossSize) / crossStride) + 1);
      const drawnWidth = crossSize + (count - 1) * crossStride;
      const firstX = segment.startX + (segmentWidth - drawnWidth) / 2;
      return Array.from({ length: count }, (_, index) => {
        const x = firstX + index * crossStride;
        return `<path class="state-unknown-cross" data-segment-id="${escapeXml(segment.id)}" d="M ${x} ${baseY - 12} L ${x + crossSize} ${baseY + 12} M ${x + crossSize} ${baseY - 12} L ${x} ${baseY + 12}"/>`;
      }).join('');
    }).join('');
    const transitionTargets = document.semantic.transitions
      .filter((transition) => transition.signalId === signalId)
      .map((transition) => {
        const x = markerX.get(transition.markerId);
        return `<circle class="transition-target" data-transition-id="${escapeXml(transition.id)}" cx="${x}" cy="${baseY}" r="7"><title>${escapeXml(`${signal.name}: ${transition.fromState} → ${transition.toState}`)}</title></circle>`;
      }).join('');
    const segmentLabels = segments.map((segment) => `<text class="state-label ${stateClass(segment.state)}" x="${segment.endX - 4}" y="${stateY(baseY, segment.state) - 8}" text-anchor="end">${escapeXml(segment.state)}</text>`).join('');
    const signalLabels = includeSignalLabels
      ? `<text class="signal-label" x="22" y="${baseY + 5}">${escapeXml(signal.name)}</text><text class="signal-type" x="22" y="${baseY + 23}">${escapeXml(signal.type)}</text>`
      : '';
    return `<g class="signal-row" data-signal-id="${escapeXml(signal.id)}">${signalLabels}<line class="row-guide" data-canvas-pan-surface="true" x1="${leftX}" x2="${endX}" y1="${baseY}" y2="${baseY}"/><path class="waveform-path" data-canvas-pan-surface="true" d="${path}"/>${unknownBands}${unknownBoundaries}${unknownCrosses}${segmentLabels}${transitionTargets}</g>`;
  }).join('');

  const markerColumns = markers.map((marker) => {
    const x = markerX.get(marker.id);
    return `<g class="marker-column" data-marker-id="${escapeXml(marker.id)}"><line x1="${x}" x2="${x}" y1="65" y2="${timingBottomY + 12}"/><text x="${x}" y="50" text-anchor="middle">#${marker.sequence}</text></g>`;
  }).join('');

  const phaseLanes = phaseList.map((relation, index) => {
    const startTransition = transitionById.get(relation.startTransitionId);
    const endTransition = transitionById.get(relation.endTransitionId);
    if (!startTransition || !endTransition) return '';
    const storedPosition = document.presentation?.phasePositions?.[relation.id];
    const position = Number.isFinite(storedPosition) ? clamp(storedPosition, 0, 1) : Math.min(0.8, 0.2 + index * 0.12);
    const y = timingTopY + (timingBottomY - timingTopY) * position;
    const startX = markerX.get(startTransition.markerId);
    const endRelationX = markerX.get(endTransition.markerId);
    const connectorFor = (endpoint, transition, x) => {
      const signalY = signalYById.get(transition.signalId);
      if (!Number.isFinite(x) || !Number.isFinite(signalY)) return '';
      return `<line class="phase-connector ${endpoint}" data-transition-id="${escapeXml(transition.id)}" x1="${x}" x2="${x}" y1="${y}" y2="${signalY}"/><circle class="phase-connection-mark ${endpoint}" data-transition-id="${escapeXml(transition.id)}" cx="${x}" cy="${signalY}" r="4" fill="currentColor"/>`;
    };
    const connectors = connectorFor('start', startTransition, startX) + connectorFor('end', endTransition, endRelationX);
    return `<g class="relation-lane phase" data-relation-id="${escapeXml(relation.id)}" data-relation-kind="phase" data-phase-position="${position}" data-relation-y="${y}">${connectors}<line class="relation-drag-target" x1="${startX}" x2="${endRelationX}" y1="${y}" y2="${y}"/><line class="relation-arrow" x1="${startX}" x2="${endRelationX}" y1="${y}" y2="${y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><circle class="relation-endpoint" data-relation-id="${escapeXml(relation.id)}" data-relation-kind="phase" data-relation-endpoint="start" cx="${startX}" cy="${y}" r="6"/><circle class="relation-endpoint" data-relation-id="${escapeXml(relation.id)}" data-relation-kind="phase" data-relation-endpoint="end" cx="${endRelationX}" cy="${y}" r="6"/><text x="${(startX + endRelationX) / 2}" y="${y - 8}" text-anchor="middle">${escapeXml(relation.name)}</text></g>`;
  }).join('');

  const timingLanes = timingList.map((relation, index) => {
    const startTransition = transitionById.get(relation.startTransitionIds[0]);
    const endTransition = transitionById.get(relation.endTransitionIds[0]);
    if (!startTransition || !endTransition) return '';
    const storedPosition = document.presentation?.timingParameterPositions?.[relation.id];
    const position = Number.isFinite(storedPosition) ? clamp(storedPosition, 0, 1) : Math.min(0.8, 0.2 + index * 0.12);
    const y = timingTopY + (timingBottomY - timingTopY) * position;
    const startX = markerX.get(startTransition.markerId);
    const endRelationX = markerX.get(endTransition.markerId);
    const requirement = relation.requirementText ? ` ${relation.requirementText}` : '';
    const connectorsFor = (endpoint, transitionIds) => transitionIds.map((transitionId) => {
      const transition = transitionById.get(transitionId);
      if (!transition) return '';
      const x = markerX.get(transition.markerId);
      const signalY = signalYById.get(transition.signalId);
      if (!Number.isFinite(x) || !Number.isFinite(signalY)) return '';
      return `<line class="timing-connector ${endpoint}" data-transition-id="${escapeXml(transition.id)}" x1="${x}" x2="${x}" y1="${y}" y2="${signalY}"/><circle class="timing-connection-mark ${endpoint}" data-transition-id="${escapeXml(transition.id)}" cx="${x}" cy="${signalY}" r="4" fill="currentColor"/>`;
    }).join('');
    const connectors = connectorsFor('start', relation.startTransitionIds) + connectorsFor('end', relation.endTransitionIds);
    return `<g class="relation-lane timing" data-relation-id="${escapeXml(relation.id)}" data-relation-kind="timing" data-timing-position="${position}" data-relation-y="${y}">${connectors}<line class="relation-drag-target" x1="${startX}" x2="${endRelationX}" y1="${y}" y2="${y}"/><line class="relation-arrow" x1="${startX}" x2="${endRelationX}" y1="${y}" y2="${y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><circle class="relation-endpoint" data-relation-id="${escapeXml(relation.id)}" data-relation-kind="timing" data-relation-endpoint="start" cx="${startX}" cy="${y}" r="6"/><circle class="relation-endpoint" data-relation-id="${escapeXml(relation.id)}" data-relation-kind="timing" data-relation-endpoint="end" cx="${endRelationX}" cy="${y}" r="6"/><text x="${(startX + endRelationX) / 2}" y="${y - 8}" text-anchor="middle">${escapeXml(`${relation.name}${requirement}`)}</text></g>`;
  }).join('');

  const annotations = document.semantic.annotations.map((annotation, index) =>
    `<text class="annotation" x="${leftX}" y="${height - 24 - index * 18}">Note: ${escapeXml(annotation.text)}</text>`
  ).join('');
  const resizeHandles = layout.gaps.map((gap) =>
    `<g class="slot-resize-handle" data-slot-resize-start-marker-id="${escapeXml(gap.startMarkerId)}" data-slot-start-x="${gap.startX}" data-slot-width-units="${gap.widthUnits}"><line x1="${gap.endX}" x2="${gap.endX}" y1="18" y2="34"/><circle cx="${gap.endX}" cy="26" r="10"/></g>`
  ).join('');
  const watermark = draft ? `<g class="draft-watermark"><text x="${width / 2}" y="${height / 2}" text-anchor="middle">DRAFT / INVALID</text></g>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-timeline-left-x="${leftX}" data-timing-top-y="${timingTopY}" data-timing-bottom-y="${timingBottomY}" role="img" aria-label="${escapeXml(document.metadata?.title ?? 'Waveform')}"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M 0 0 L 6 3 L 0 6 Z" fill="currentColor"/></marker><style>.waveform-bg{fill:#fff}.row-guide,.marker-column line{stroke:#d9e1ee;stroke-dasharray:3 5}.signal-label{fill:#172033;font:700 14px system-ui}.signal-type{fill:#738198;font:11px system-ui}.waveform-path{fill:none;stroke:#2a3038;stroke-width:3;stroke-linejoin:round}.state-unknown-band{pointer-events:none}.state-unknown-boundary{pointer-events:none;stroke:#2563eb;stroke-width:1.6}.state-unknown-cross{fill:none;pointer-events:none;stroke:#2563eb;stroke-width:1.6}.state-label{font:10px system-ui}.state-known{fill:#2767a8}.state-unknown{fill:#2563eb}.state-unspecified{fill:#8794a8}.transition-target{fill:#fff;stroke:#123f75;stroke-width:2;cursor:pointer}.marker-column text{fill:#6d7b90;font:11px system-ui}.relation-lane{color:#245c9f}.relation-lane.phase{color:#8b4a12}.relation-lane line{stroke:currentColor;stroke-width:2}.relation-lane text{fill:currentColor;font:12px system-ui;font-weight:700}.relation-lane.timing .relation-drag-target{cursor:ns-resize;stroke:#fff;stroke-opacity:.9;stroke-width:12}.relation-lane.phase .relation-drag-target{cursor:ns-resize;stroke:#fff;stroke-opacity:.9;stroke-width:12}.relation-lane.timing .relation-arrow,.relation-lane.timing text{cursor:ns-resize}.relation-lane.phase .relation-arrow,.relation-lane.phase text{cursor:ns-resize}.relation-lane.timing .timing-connector{pointer-events:none;stroke:#1c1f24}.relation-lane.phase .phase-connector{pointer-events:none;stroke:#1c1f24}.relation-lane.timing .timing-connection-mark{pointer-events:none}.relation-lane.phase .phase-connection-mark{pointer-events:none}.relation-endpoint{fill:#fff;stroke:currentColor;stroke-width:2;cursor:ew-resize}.slot-resize-handle{cursor:ew-resize}.slot-resize-handle line{stroke:#5f718e;stroke-width:2;pointer-events:none}.slot-resize-handle circle{fill:transparent;stroke:#5f718e;stroke-width:2}.annotation{fill:#5a6474;font:12px system-ui}.draft-watermark text{fill:#c43333;fill-opacity:.2;font:700 52px system-ui;transform:rotate(-18deg);transform-origin:center}</style></defs><rect class="waveform-bg" data-canvas-pan-surface="true" width="100%" height="100%"/>${markerColumns}${rows}${phaseLanes}${timingLanes}${annotations}${watermark}${resizeHandles}</svg>`;
}

function loadSvgImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unable to render SVG as PNG.')); };
    image.src = url;
  });
}

export async function svgToPngBlob(svgElement) {
  const source = typeof svgElement === 'string' ? svgElement : new XMLSerializer().serializeToString(svgElement);
  const image = await loadSvgImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.width || Number(svgElement.getAttribute?.('width'));
  canvas.height = image.height || Number(svgElement.getAttribute?.('height'));
  canvas.getContext('2d').drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
}
