import { BASE_SLOT_WIDTH, SLOT_WIDTH_UNIT_MAX, SLOT_WIDTH_UNIT_MIN } from '../domain/constants.js';
import {
  addPhase,
  addTimingParameter,
  moveMarker,
  moveTransition,
  rebindTimingEndpoint,
  setPhasePosition,
  setSlotWidth,
  setTimingParameterPosition,
  updatePhase
} from '../domain/operations.js';
import { createTimelineLayout } from '../render/timeline-layout.js';

export function resolveDropTransitionId(root, clientX, clientY) {
  return root.elementFromPoint(clientX, clientY)?.closest('[data-transition-id]')?.dataset.transitionId ?? null;
}

export function relationEndpointUpdates(relationKind, endpoint, transitionId) {
  if (relationKind === 'timing') {
    return endpoint === 'start'
      ? { startTransitionIds: [transitionId] }
      : { endTransitionIds: [transitionId] };
  }
  return endpoint === 'start'
    ? { startTransitionId: transitionId }
    : { endTransitionId: transitionId };
}

export function applyRelationEndpointDrop(documentModel, { relationKind, relationId, endpoint, transitionId }) {
  if (relationKind === 'timing') {
    return rebindTimingEndpoint(documentModel, { parameterId: relationId, endpoint, transitionId });
  }
  return updatePhase(documentModel, relationId, relationEndpointUpdates(relationKind, endpoint, transitionId));
}

function pointerSvgX(svg, event) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return ((event.clientX - rect.left) / rect.width) * viewBox.width;
}

export function sequenceFromPointer(svg, event, documentModel) {
  const x = pointerSvgX(svg, event);
  const leftX = Number(svg.dataset?.timelineLeftX ?? 170);
  if (documentModel) return Math.round(createTimelineLayout(documentModel, { leftX }).slotCoordinateForX(x));
  return Math.round((x - leftX) / BASE_SLOT_WIDTH);
}

export function slotWidthFromPointer(svg, event, drag) {
  const widthUnits = (pointerSvgX(svg, event) - drag.startX) / BASE_SLOT_WIDTH;
  return Math.max(SLOT_WIDTH_UNIT_MIN, Math.min(SLOT_WIDTH_UNIT_MAX, widthUnits));
}

export function pointerSvgY(svg, event) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return ((event.clientY - rect.top) / rect.height) * viewBox.height;
}

export function timingPositionFromPointer(svg, event, { grabOffsetY = 0 } = {}) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const top = Number(svg.dataset.timingTopY);
  const bottom = Number(svg.dataset.timingBottomY);
  if (!(rect.height > 0) || !(viewBox.height > 0) || !Number.isFinite(top) || !(bottom > top)) return 0.5;
  const y = pointerSvgY(svg, event) - grabOffsetY;
  return Math.max(0, Math.min(1, (y - top) / (bottom - top)));
}

export function bindCanvasPointerEvents(svg, {
  root,
  editor,
  getState,
  applyOperation,
  setNotice,
  render,
  previewCanvas,
  showDragFeedback,
  clearDragFeedback,
  dragMessage
}) {
  svg.addEventListener('pointerdown', (event) => {
    const state = getState();
    const slotResize = event.target.closest('[data-slot-resize-start-marker-id]');
    const relationEndpoint = event.target.closest('[data-relation-endpoint]');
    const timingRelation = event.target.closest('[data-relation-kind="timing"][data-relation-id]');
    const phaseRelation = event.target.closest('[data-relation-kind="phase"][data-relation-id]');
    const positionedRelation = timingRelation ?? phaseRelation;
    const transition = event.target.closest('[data-transition-id]');
    const marker = event.target.closest('[data-marker-id]');
    const panSurface = event.target.closest('[data-canvas-pan-surface]');
    if (slotResize) {
      state.drag = {
        kind: 'slot-width',
        startMarkerId: slotResize.dataset.slotResizeStartMarkerId,
        startX: Number(slotResize.dataset.slotStartX),
        widthUnits: Number(slotResize.dataset.slotWidthUnits)
      };
    } else if (relationEndpoint) {
      state.drag = {
        kind: 'relation-endpoint',
        relationId: relationEndpoint.dataset.relationId,
        relationKind: relationEndpoint.dataset.relationKind,
        endpoint: relationEndpoint.dataset.relationEndpoint
      };
    } else if (positionedRelation) {
      const relationKind = positionedRelation.dataset.relationKind;
      const positionById = relationKind === 'timing'
        ? state.document.presentation?.timingParameterPositions
        : state.document.presentation?.phasePositions;
      const storedPosition = positionById?.[positionedRelation.dataset.relationId];
      const connectorClass = relationKind === 'timing' ? 'timing-connector' : 'phase-connector';
      const connectionMarkClass = relationKind === 'timing' ? 'timing-connection-mark' : 'phase-connection-mark';
      const transitionAnchors = [...positionedRelation.querySelectorAll(`.${connectorClass}, .${connectionMarkClass}`)]
        .map((element) => {
          const attribute = element.classList.contains(connectorClass) ? 'y2' : 'cy';
          return { element, attribute, value: Number(element.getAttribute(attribute)) };
        })
        .filter((anchor) => Number.isFinite(anchor.value));
      state.drag = {
        kind: `${relationKind}-position`,
        id: positionedRelation.dataset.relationId,
        relationKind,
        originalY: Number(positionedRelation.dataset.relationY),
        grabOffsetY: pointerSvgY(svg, event) - Number(positionedRelation.dataset.relationY),
        position: Number.isFinite(storedPosition)
          ? storedPosition
          : Number(positionedRelation.dataset[relationKind === 'timing' ? 'timingPosition' : 'phasePosition']),
        transitionAnchors
      };
    } else if (transition && state.relationCreation) {
      state.drag = { kind: 'relation-creation' };
    } else if (transition) {
      state.selectedTransitionId = transition.dataset.transitionId;
      state.drag = { kind: 'transition', id: transition.dataset.transitionId };
    } else if (marker) {
      state.drag = { kind: 'marker', id: marker.dataset.markerId };
    } else if (panSurface) {
      const canvas = editor.querySelector('#waveform-canvas');
      if (!canvas) return;
      state.drag = {
        kind: 'canvas-pan',
        startClientX: event.clientX,
        scrollLeft: canvas.scrollLeft
      };
    } else return;
    svg.setPointerCapture(event.pointerId);
    showDragFeedback(svg, state.drag, slotResize ?? relationEndpoint ?? positionedRelation ?? transition ?? marker ?? panSurface);
    event.stopPropagation();
    event.preventDefault();
  });
  svg.addEventListener('pointermove', (event) => {
    const state = getState();
    if (!state.drag) return;
    const status = editor.querySelector('#drag-status');
    if (state.drag.kind === 'canvas-pan') {
      const canvas = editor.querySelector('#waveform-canvas');
      if (canvas) canvas.scrollLeft = Math.max(0, state.drag.scrollLeft - (event.clientX - state.drag.startClientX));
      if (status) status.textContent = dragMessage(state.drag);
    } else if (state.drag.kind === 'slot-width') {
      state.drag.widthUnits = slotWidthFromPointer(svg, event, state.drag);
      previewCanvas({
        ...(state.document.presentation?.slotWidthUnits ?? {}),
        [state.drag.startMarkerId]: state.drag.widthUnits
      }, event.pointerId, state.drag);
    } else if (state.drag.kind === 'timing-position' || state.drag.kind === 'phase-position') {
      const position = timingPositionFromPointer(svg, event, { grabOffsetY: state.drag.grabOffsetY });
      state.drag.position = position;
      const top = Number(svg.dataset.timingTopY);
      const bottom = Number(svg.dataset.timingBottomY);
      const previewY = top + (bottom - top) * position;
      const positionedRelation = svg.querySelector(`[data-relation-kind="${state.drag.relationKind}"][data-relation-id="${state.drag.id}"]`);
      const translation = previewY - state.drag.originalY;
      positionedRelation?.setAttribute('transform', `translate(0 ${translation})`);
      state.drag.transitionAnchors.forEach(({ element, attribute, value }) => {
        element.setAttribute(attribute, String(value - translation));
      });
      if (status) status.textContent = dragMessage(state.drag, position);
    } else if (status && (state.drag.kind === 'transition' || state.drag.kind === 'marker')) {
      status.textContent = dragMessage(state.drag, sequenceFromPointer(svg, event, state.document));
    }
    event.preventDefault();
  });
  svg.addEventListener('pointerup', (event) => {
    const state = getState();
    if (!state.drag) return;
    const drag = state.drag;
    state.drag = null;
    clearDragFeedback(svg);
    event.preventDefault();
    if (drag.kind === 'canvas-pan') return;
    if (drag.kind === 'slot-width') {
      drag.widthUnits = slotWidthFromPointer(svg, event, drag);
      applyOperation((documentModel) => setSlotWidth(documentModel, {
        startMarkerId: drag.startMarkerId,
        widthUnits: drag.widthUnits
      }));
      return;
    }
    if (drag.kind === 'timing-position') {
      applyOperation((documentModel) => setTimingParameterPosition(documentModel, { parameterId: drag.id, position: drag.position }));
      return;
    }
    if (drag.kind === 'phase-position') {
      applyOperation((documentModel) => setPhasePosition(documentModel, { phaseId: drag.id, position: drag.position }));
      return;
    }
    if (drag.kind === 'relation-endpoint') {
      const targetTransitionId = resolveDropTransitionId(root, event.clientX, event.clientY);
      if (!targetTransitionId) {
        setNotice('Drop a relation endpoint on a transition point.');
        render();
        return;
      }
      applyOperation((documentModel) => applyRelationEndpointDrop(documentModel, {
        relationKind: drag.relationKind,
        relationId: drag.relationId,
        endpoint: drag.endpoint,
        transitionId: targetTransitionId
      }));
      return;
    }
    if (drag.kind === 'relation-creation') {
      const targetTransitionId = resolveDropTransitionId(root, event.clientX, event.clientY);
      if (!targetTransitionId) {
        setNotice('Select a transition point on the canvas.');
        render();
        return;
      }
      if (!state.relationCreation.firstTransitionId) {
        state.relationCreation.firstTransitionId = targetTransitionId;
        setNotice('Start transition selected. Select the end transition.');
        render();
        return;
      }
      const creation = state.relationCreation;
      state.relationCreation = null;
      applyOperation((documentModel) => creation.kind === 'timing'
        ? addTimingParameter(documentModel, { ...creation.values, startTransitionIds: [creation.firstTransitionId], endTransitionIds: [targetTransitionId] })
        : addPhase(documentModel, { ...creation.values, tags: String(creation.values.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean), startTransitionId: creation.firstTransitionId, endTransitionId: targetTransitionId }));
      return;
    }
    const targetSequence = sequenceFromPointer(svg, event, state.document);
    applyOperation((documentModel) => drag.kind === 'marker'
      ? moveMarker(documentModel, { markerId: drag.id, targetSequence })
      : moveTransition(documentModel, { transitionId: drag.id, targetSequence }));
  });
  svg.addEventListener('pointercancel', () => {
    const state = getState();
    if (!state.drag) return;
    const drag = state.drag;
    state.drag = null;
    clearDragFeedback(svg);
    if (drag.kind === 'canvas-pan') return;
    setNotice('Drag cancelled.');
    render();
  });
  svg.addEventListener('dragstart', (event) => event.preventDefault());
}
