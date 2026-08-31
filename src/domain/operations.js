import { ANNOTATION_ANCHOR_TYPES, SIGNAL_TYPES, STATES } from './constants.js';
import { cloneDocument, createId, getSignal } from './document.js';

function markerSequence(document, markerId) {
  if (markerId === document.semantic.timeline.startMarkerId) return Number.NEGATIVE_INFINITY;
  if (markerId === document.semantic.timeline.endMarkerId) return Number.POSITIVE_INFINITY;
  const marker = document.semantic.timeline.timeMarkers.find((item) => item.id === markerId);
  return marker ? marker.sequence : Number.NaN;
}

function orderedSegments(document, signalId) {
  return document.semantic.stateSegments
    .filter((segment) => segment.signalId === signalId)
    .sort((left, right) => markerSequence(document, left.startMarkerId) - markerSequence(document, right.startMarkerId));
}

function ensureMarker(document, sequence) {
  if (!Number.isInteger(sequence)) throw new Error('Marker sequence must be an integer.');
  const found = document.semantic.timeline.timeMarkers.find((marker) => marker.sequence === sequence);
  if (found) return found;

  const marker = { id: createId('tm'), sequence, transitionIds: [] };
  document.semantic.timeline.timeMarkers.push(marker);
  return marker;
}

function removeUnusedMarkers(document) {
  document.semantic.timeline.timeMarkers = document.semantic.timeline.timeMarkers
    .filter((marker) => marker.transitionIds.length > 0)
    .sort((left, right) => left.sequence - right.sequence);
}

function rederiveSignalTransitions(document, signalId, forcedIdsByMarkerId = new Map()) {
  const oldTransitions = document.semantic.transitions.filter((transition) => transition.signalId === signalId);
  const oldByMarkerId = new Map(oldTransitions.map((transition) => [transition.markerId, transition]));
  const oldIds = new Set(oldTransitions.map((transition) => transition.id));

  document.semantic.transitions = document.semantic.transitions.filter((transition) => transition.signalId !== signalId);
  for (const marker of document.semantic.timeline.timeMarkers) {
    marker.transitionIds = marker.transitionIds.filter((id) => !oldIds.has(id));
  }

  const derived = [];
  const segments = orderedSegments(document, signalId);
  for (let index = 0; index < segments.length - 1; index += 1) {
    const left = segments[index];
    const right = segments[index + 1];
    if (left.endMarkerId !== right.startMarkerId || left.state === right.state) continue;

    const marker = document.semantic.timeline.timeMarkers.find((item) => item.id === left.endMarkerId);
    if (!marker) throw new Error('A transition boundary must reference a time marker.');

    const existing = oldByMarkerId.get(marker.id);
    const transition = {
      id: forcedIdsByMarkerId.get(marker.id) ?? existing?.id ?? createId('tr'),
      signalId,
      markerId: marker.id,
      fromState: left.state,
      toState: right.state,
      derivedFromSegmentIds: [left.id, right.id]
    };
    marker.transitionIds.push(transition.id);
    derived.push(transition);
  }

  document.semantic.transitions.push(...derived);
  removeUnusedMarkers(document);
}

function segmentPairForTransition(document, transition) {
  const byId = new Map(document.semantic.stateSegments.map((segment) => [segment.id, segment]));
  const [leftId, rightId] = transition.derivedFromSegmentIds ?? [];
  const left = byId.get(leftId);
  const right = byId.get(rightId);
  if (!left || !right || left.signalId !== transition.signalId || right.signalId !== transition.signalId) {
    throw new Error('Transition no longer has a valid adjacent segment pair.');
  }
  return { left, right };
}

export function addSignal(document, {
  name,
  type = 'custom',
  subtype = '',
  tags = [],
  initialState = 'LOW'
}) {
  if (!name?.trim()) throw new Error('Signal name is required.');
  if (!SIGNAL_TYPES.includes(type)) throw new Error(`Unsupported signal type: ${type}`);
  if (!STATES.includes(initialState)) throw new Error(`Unsupported signal state: ${initialState}`);

  const next = cloneDocument(document);
  const signal = {
    id: createId('sig'),
    name: name.trim(),
    type,
    subtype,
    tags: [...tags],
    initialState
  };
  next.semantic.signals.push(signal);
  next.presentation.signalRowOrder.push(signal.id);
  next.semantic.stateSegments.push({
    id: createId('seg'),
    signalId: signal.id,
    startMarkerId: next.semantic.timeline.startMarkerId,
    endMarkerId: next.semantic.timeline.endMarkerId,
    state: initialState
  });
  return next;
}

export function updateSignal(document, signalId, { name, type, subtype, tags, initialState }) {
  const next = cloneDocument(document);
  const signal = next.semantic.signals.find((item) => item.id === signalId);
  if (!signal) throw new Error('Signal does not exist.');
  if (name !== undefined) {
    if (!name.trim()) throw new Error('Signal name is required.');
    signal.name = name.trim();
  }
  if (type !== undefined && !SIGNAL_TYPES.includes(type)) throw new Error(`Unsupported signal type: ${type}`);
  if (type !== undefined) signal.type = type;
  if (subtype !== undefined) signal.subtype = subtype;
  if (tags !== undefined) signal.tags = [...tags];
  if (initialState !== undefined) {
    if (!STATES.includes(initialState)) throw new Error(`Unsupported signal state: ${initialState}`);
    const segments = orderedSegments(next, signalId);
    const first = segments[0];
    const following = segments[1];
    if (!first) throw new Error('Signal has no state segment.');
    if (following?.state === initialState) {
      throw new Error('Initial state cannot match the next state segment. Change or remove that transition first.');
    }
    signal.initialState = initialState;
    first.state = initialState;
    rederiveSignalTransitions(next, signalId);
  }
  return next;
}

export function moveSignalRow(document, { signalId, targetIndex }) {
  const next = cloneDocument(document);
  const currentIndex = next.presentation.signalRowOrder.indexOf(signalId);
  if (currentIndex < 0) throw new Error('Signal is not present in the row order.');
  const boundedIndex = Math.max(0, Math.min(Number(targetIndex), next.presentation.signalRowOrder.length - 1));
  next.presentation.signalRowOrder.splice(currentIndex, 1);
  next.presentation.signalRowOrder.splice(boundedIndex, 0, signalId);
  return next;
}

export function deleteSignal(document, signalId) {
  if (!getSignal(document, signalId)) throw new Error('Signal does not exist.');
  const next = cloneDocument(document);
  const transitionIds = new Set(next.semantic.transitions
    .filter((transition) => transition.signalId === signalId)
    .map((transition) => transition.id));
  const parameterIds = new Set(next.semantic.timingParameters
    .filter((parameter) => transitionIds.has(parameter.startTransitionId) || transitionIds.has(parameter.endTransitionId))
    .map((parameter) => parameter.id));
  const phaseIds = new Set(next.semantic.phases
    .filter((phase) => transitionIds.has(phase.startTransitionId) || transitionIds.has(phase.endTransitionId))
    .map((phase) => phase.id));

  next.semantic.signals = next.semantic.signals.filter((signal) => signal.id !== signalId);
  next.semantic.stateSegments = next.semantic.stateSegments.filter((segment) => segment.signalId !== signalId);
  next.semantic.transitions = next.semantic.transitions.filter((transition) => !transitionIds.has(transition.id));
  next.semantic.timingParameters = next.semantic.timingParameters.filter((parameter) => !parameterIds.has(parameter.id));
  next.semantic.phases = next.semantic.phases.filter((phase) => !phaseIds.has(phase.id));
  next.semantic.annotations = next.semantic.annotations.filter((annotation) =>
    !(annotation.anchorType === 'signal' && annotation.anchorId === signalId) &&
    !(annotation.anchorType === 'transition' && transitionIds.has(annotation.anchorId)) &&
    !(annotation.anchorType === 'timingParameter' && parameterIds.has(annotation.anchorId)) &&
    !(annotation.anchorType === 'phase' && phaseIds.has(annotation.anchorId))
  );
  for (const marker of next.semantic.timeline.timeMarkers) {
    marker.transitionIds = marker.transitionIds.filter((transitionId) => !transitionIds.has(transitionId));
  }
  next.presentation.signalRowOrder = next.presentation.signalRowOrder.filter((id) => id !== signalId);
  next.presentation.timingLaneOrder = next.presentation.timingLaneOrder.filter((id) => !parameterIds.has(id) && !phaseIds.has(id));
  if (next.presentation.timingParameterPositions) {
    for (const parameterId of parameterIds) delete next.presentation.timingParameterPositions[parameterId];
  }
  removeUnusedMarkers(next);
  return next;
}

export function setSegmentBoundary(document, { signalId, sequence, rightState }) {
  if (!getSignal(document, signalId)) throw new Error('Signal does not exist.');
  if (!STATES.includes(rightState)) throw new Error(`Unsupported signal state: ${rightState}`);

  const next = cloneDocument(document);
  const target = orderedSegments(next, signalId).find((segment) => {
    const start = markerSequence(next, segment.startMarkerId);
    const end = markerSequence(next, segment.endMarkerId);
    return start < sequence && sequence < end;
  });
  if (!target) throw new Error('A segment boundary must fall inside one signal segment.');
  if (target.state === rightState) throw new Error('A segment boundary must change the signal state.');
  const marker = ensureMarker(next, sequence);

  const right = {
    id: createId('seg'),
    signalId,
    startMarkerId: marker.id,
    endMarkerId: target.endMarkerId,
    state: rightState
  };
  target.endMarkerId = marker.id;
  const targetIndex = next.semantic.stateSegments.findIndex((segment) => segment.id === target.id);
  next.semantic.stateSegments.splice(targetIndex + 1, 0, right);
  rederiveSignalTransitions(next, signalId);
  return next;
}

function coalesceSignalSegments(document, signalId) {
  const segments = orderedSegments(document, signalId);
  const merged = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && previous.state === segment.state && previous.endMarkerId === segment.startMarkerId) {
      previous.endMarkerId = segment.endMarkerId;
    } else {
      merged.push(segment);
    }
  }
  document.semantic.stateSegments = [
    ...document.semantic.stateSegments.filter((segment) => segment.signalId !== signalId),
    ...merged
  ];
}

export function getMarkerSequence(document) {
  return [...document.semantic.timeline.timeMarkers].sort((left, right) => left.sequence - right.sequence);
}

export function getTransitions(document) {
  return document.semantic.transitions;
}

export function moveTransition(document, { transitionId, targetSequence }) {
  const source = document.semantic.transitions.find((transition) => transition.id === transitionId);
  if (!source) throw new Error('Transition does not exist.');
  if (!Number.isInteger(targetSequence)) throw new Error('Marker sequence must be an integer.');

  const next = cloneDocument(document);
  const transition = next.semantic.transitions.find((item) => item.id === transitionId);
  const { left, right } = segmentPairForTransition(next, transition);
  const start = markerSequence(next, left.startMarkerId);
  const end = markerSequence(next, right.endMarkerId);
  if (!(start < targetSequence && targetSequence < end)) {
    throw new Error('Transition must remain between its adjacent segment boundaries.');
  }
  const currentSequence = markerSequence(next, transition.markerId);
  if (currentSequence === targetSequence) return next;

  const targetMarker = ensureMarker(next, targetSequence);
  left.endMarkerId = targetMarker.id;
  right.startMarkerId = targetMarker.id;
  rederiveSignalTransitions(next, transition.signalId, new Map([[targetMarker.id, transitionId]]));
  return next;
}

export function updateTransition(document, transitionId, { signalId, sequence, rightState } = {}) {
  const source = document.semantic.transitions.find((transition) => transition.id === transitionId);
  if (!source) throw new Error('Transition does not exist.');

  const currentSequence = markerSequence(document, source.markerId);
  const targetSequence = sequence === undefined ? currentSequence : Number(sequence);
  if (!Number.isInteger(targetSequence)) throw new Error('Marker sequence must be an integer.');
  const targetSignalId = signalId ?? source.signalId;
  if (!getSignal(document, targetSignalId)) throw new Error('Signal does not exist.');
  const targetRightState = rightState ?? source.toState;
  if (!STATES.includes(targetRightState)) throw new Error(`Unsupported signal state: ${targetRightState}`);

  if (targetSignalId !== source.signalId) {
    const next = cloneDocument(document);
    const transition = next.semantic.transitions.find((item) => item.id === transitionId);
    const { left, right } = segmentPairForTransition(next, transition);
    left.endMarkerId = right.endMarkerId;
    next.semantic.stateSegments = next.semantic.stateSegments.filter((segment) => segment.id !== right.id);
    coalesceSignalSegments(next, transition.signalId);
    rederiveSignalTransitions(next, transition.signalId);

    const targetSegments = orderedSegments(next, targetSignalId);
    const target = targetSegments.find((segment) => {
      const start = markerSequence(next, segment.startMarkerId);
      const end = markerSequence(next, segment.endMarkerId);
      return start < targetSequence && targetSequence < end;
    });
    if (!target) throw new Error('A transition must fall inside one target signal segment.');
    if (target.state === targetRightState) throw new Error('A transition must change the target signal state.');
    const targetIndex = targetSegments.findIndex((segment) => segment.id === target.id);
    if (targetSegments[targetIndex + 1]?.state === targetRightState) {
      throw new Error('State after a transition cannot merge with the following state segment.');
    }

    const marker = ensureMarker(next, targetSequence);
    const rightTargetSegment = {
      id: createId('seg'),
      signalId: targetSignalId,
      startMarkerId: marker.id,
      endMarkerId: target.endMarkerId,
      state: targetRightState
    };
    target.endMarkerId = marker.id;
    const insertionIndex = next.semantic.stateSegments.findIndex((segment) => segment.id === target.id);
    next.semantic.stateSegments.splice(insertionIndex + 1, 0, rightTargetSegment);
    rederiveSignalTransitions(next, targetSignalId, new Map([[marker.id, transitionId]]));
    return next;
  }

  let next = targetSequence === currentSequence
    ? cloneDocument(document)
    : moveTransition(document, { transitionId, targetSequence });

  const transition = next.semantic.transitions.find((item) => item.id === transitionId);
  const { left, right } = segmentPairForTransition(next, transition);
  if (left.state === targetRightState) {
    throw new Error('State after a transition must differ from its previous state.');
  }

  const segments = orderedSegments(next, transition.signalId);
  const rightIndex = segments.findIndex((segment) => segment.id === right.id);
  const following = segments[rightIndex + 1];
  if (following?.state === targetRightState) {
    throw new Error('State after a transition cannot merge with the following state segment.');
  }

  right.state = targetRightState;
  rederiveSignalTransitions(next, transition.signalId, new Map([[transition.markerId, transitionId]]));
  return next;
}

export function moveMarker(document, { markerId, targetSequence }) {
  const sourceMarker = document.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId);
  if (!sourceMarker) throw new Error('Marker does not exist.');
  if (!Number.isInteger(targetSequence)) throw new Error('Marker sequence must be an integer.');
  if (sourceMarker.sequence === targetSequence) return cloneDocument(document);

  const sourceTransitions = sourceMarker.transitionIds
    .map((transitionId) => document.semantic.transitions.find((transition) => transition.id === transitionId))
    .filter(Boolean);
  const existingTarget = document.semantic.timeline.timeMarkers.find((marker) => marker.sequence === targetSequence);
  const targetSignalIds = new Set((existingTarget?.transitionIds ?? [])
    .map((transitionId) => document.semantic.transitions.find((transition) => transition.id === transitionId)?.signalId)
    .filter(Boolean));
  if (sourceTransitions.some((transition) => targetSignalIds.has(transition.signalId))) {
    throw new Error('A marker cannot merge two transitions from the same signal.');
  }
  for (const transition of sourceTransitions) {
    const { left, right } = segmentPairForTransition(document, transition);
    if (!(markerSequence(document, left.startMarkerId) < targetSequence && targetSequence < markerSequence(document, right.endMarkerId))) {
      throw new Error('Marker must remain inside every moved transition interval.');
    }
  }

  const next = cloneDocument(document);
  const target = ensureMarker(next, targetSequence);
  const sourceTransitionIds = new Set(sourceTransitions.map((transition) => transition.id));
  for (const segment of next.semantic.stateSegments) {
    if (segment.startMarkerId === markerId) segment.startMarkerId = target.id;
    if (segment.endMarkerId === markerId) segment.endMarkerId = target.id;
  }
  const forcedBySignal = new Map(sourceTransitions.map((transition) => [transition.signalId, transition.id]));
  for (const [signalId, transitionId] of forcedBySignal) {
    rederiveSignalTransitions(next, signalId, new Map([[target.id, transitionId]]));
  }
  const orphan = next.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId);
  if (orphan && !orphan.transitionIds.some((id) => !sourceTransitionIds.has(id))) removeUnusedMarkers(next);
  return next;
}

export function getTransitionDependencies(document, transitionId) {
  return {
    timingParameters: document.semantic.timingParameters.filter((item) => item.startTransitionId === transitionId || item.endTransitionId === transitionId),
    phases: document.semantic.phases.filter((item) => item.startTransitionId === transitionId || item.endTransitionId === transitionId)
  };
}

export function deleteTransitionWithDependencies(document, transitionId, { cascade = false } = {}) {
  const transition = document.semantic.transitions.find((item) => item.id === transitionId);
  if (!transition) throw new Error('Transition does not exist.');
  const dependencies = getTransitionDependencies(document, transitionId);
  if (!cascade && (dependencies.timingParameters.length || dependencies.phases.length)) {
    return { document, dependencies, deleted: false };
  }

  const next = cloneDocument(document);
  next.semantic.annotations = next.semantic.annotations.filter((annotation) =>
    !(annotation.anchorType === 'transition' && annotation.anchorId === transitionId)
  );
  if (cascade) {
    next.semantic.timingParameters = next.semantic.timingParameters.filter((item) => item.startTransitionId !== transitionId && item.endTransitionId !== transitionId);
    next.semantic.phases = next.semantic.phases.filter((item) => item.startTransitionId !== transitionId && item.endTransitionId !== transitionId);
    next.presentation.timingLaneOrder = next.presentation.timingLaneOrder.filter((id) =>
      next.semantic.timingParameters.some((item) => item.id === id) || next.semantic.phases.some((item) => item.id === id)
    );
    const parameterIds = new Set(dependencies.timingParameters.map((item) => item.id));
    const phaseIds = new Set(dependencies.phases.map((item) => item.id));
    next.semantic.annotations = next.semantic.annotations.filter((annotation) =>
      !(annotation.anchorType === 'timingParameter' && parameterIds.has(annotation.anchorId)) &&
      !(annotation.anchorType === 'phase' && phaseIds.has(annotation.anchorId))
    );
    if (next.presentation.timingParameterPositions) {
      for (const parameterId of parameterIds) delete next.presentation.timingParameterPositions[parameterId];
    }
  }
  const nextTransition = next.semantic.transitions.find((item) => item.id === transitionId);
  const { left, right } = segmentPairForTransition(next, nextTransition);
  left.endMarkerId = right.endMarkerId;
  next.semantic.stateSegments = next.semantic.stateSegments.filter((segment) => segment.id !== right.id);
  coalesceSignalSegments(next, nextTransition.signalId);
  rederiveSignalTransitions(next, nextTransition.signalId);
  return { document: next, dependencies, deleted: true };
}

function transitionSequence(document, transitionId) {
  const transition = document.semantic.transitions.find((item) => item.id === transitionId);
  if (!transition) return Number.NaN;
  return markerSequence(document, transition.markerId);
}

function assertOrderedEndpoints(document, startTransitionId, endTransitionId) {
  if (!document.semantic.transitions.some((item) => item.id === startTransitionId) || !document.semantic.transitions.some((item) => item.id === endTransitionId)) {
    throw new Error('Relation endpoints must reference existing transitions.');
  }
  if (startTransitionId === endTransitionId || !(transitionSequence(document, startTransitionId) < transitionSequence(document, endTransitionId))) {
    throw new Error('Relation endpoints must be distinct and strictly left-to-right.');
  }
}

function timingNoteMetadata() {
  return { parsedRequirement: null, validationStatus: 'note' };
}

export function addTimingParameter(document, {
  name,
  startTransitionId,
  endTransitionId,
  requirementText = '',
  tags = []
}) {
  if (!name?.trim()) throw new Error('Timing parameter name is required.');
  assertOrderedEndpoints(document, startTransitionId, endTransitionId);
  const noteMetadata = timingNoteMetadata();
  const next = cloneDocument(document);
  const parameter = {
    id: createId('tp'),
    name: name.trim(),
    startTransitionId,
    endTransitionId,
    requirementText,
    ...noteMetadata,
    tags: [...tags]
  };
  next.semantic.timingParameters.push(parameter);
  next.presentation.timingLaneOrder.push(parameter.id);
  next.presentation.timingParameterPositions ??= {};
  next.presentation.timingParameterPositions[parameter.id] = Math.min(0.8, 0.2 + (next.semantic.timingParameters.length - 1) * 0.12);
  return next;
}

export function setTimingParameterPosition(document, { parameterId, position }) {
  if (!document.semantic.timingParameters.some((item) => item.id === parameterId)) {
    throw new Error('Timing parameter does not exist.');
  }
  const normalizedPosition = Number(position);
  if (!Number.isFinite(normalizedPosition) || normalizedPosition < 0 || normalizedPosition > 1) {
    throw new Error('Timing parameter position must be between 0 and 1.');
  }
  const next = cloneDocument(document);
  next.presentation.timingParameterPositions ??= {};
  next.presentation.timingParameterPositions[parameterId] = Math.round(normalizedPosition * 1000) / 1000;
  return next;
}

export function updateTimingParameter(document, parameterId, updates) {
  const current = document.semantic.timingParameters.find((item) => item.id === parameterId);
  if (!current) throw new Error('Timing parameter does not exist.');
  if (updates.name !== undefined && !updates.name.trim()) throw new Error('Timing parameter name is required.');
  const startTransitionId = updates.startTransitionId ?? current.startTransitionId;
  const endTransitionId = updates.endTransitionId ?? current.endTransitionId;
  assertOrderedEndpoints(document, startTransitionId, endTransitionId);
  const requirementText = updates.requirementText ?? current.requirementText;
  const noteMetadata = timingNoteMetadata();
  const next = cloneDocument(document);
  const parameter = next.semantic.timingParameters.find((item) => item.id === parameterId);
  parameter.name = updates.name === undefined ? parameter.name : updates.name.trim();
  parameter.startTransitionId = startTransitionId;
  parameter.endTransitionId = endTransitionId;
  parameter.requirementText = requirementText;
  parameter.parsedRequirement = noteMetadata.parsedRequirement;
  parameter.validationStatus = noteMetadata.validationStatus;
  if (updates.tags !== undefined) parameter.tags = [...updates.tags];
  return next;
}

export function addPhase(document, { name, startTransitionId, endTransitionId, tags = [] }) {
  if (!name?.trim()) throw new Error('Phase name is required.');
  assertOrderedEndpoints(document, startTransitionId, endTransitionId);
  const next = cloneDocument(document);
  const phase = { id: createId('phase'), name: name.trim(), startTransitionId, endTransitionId, tags: [...tags] };
  next.semantic.phases.push(phase);
  next.presentation.timingLaneOrder.push(phase.id);
  return next;
}

export function updatePhase(document, phaseId, updates) {
  const current = document.semantic.phases.find((item) => item.id === phaseId);
  if (!current) throw new Error('Phase does not exist.');
  const startTransitionId = updates.startTransitionId ?? current.startTransitionId;
  const endTransitionId = updates.endTransitionId ?? current.endTransitionId;
  assertOrderedEndpoints(document, startTransitionId, endTransitionId);
  const next = cloneDocument(document);
  const phase = next.semantic.phases.find((item) => item.id === phaseId);
  if (updates.name !== undefined) {
    if (!updates.name.trim()) throw new Error('Phase name is required.');
    phase.name = updates.name.trim();
  }
  phase.startTransitionId = startTransitionId;
  phase.endTransitionId = endTransitionId;
  if (updates.tags !== undefined) phase.tags = [...updates.tags];
  return next;
}

function assertAnnotationAnchor(document, anchorType, anchorId) {
  if (!ANNOTATION_ANCHOR_TYPES.includes(anchorType)) throw new Error(`Unsupported annotation anchor type: ${anchorType}`);
  if (anchorType === 'document') return;
  const collectionByAnchorType = {
    signal: document.semantic.signals,
    transition: document.semantic.transitions,
    timingParameter: document.semantic.timingParameters,
    phase: document.semantic.phases
  };
  if (!collectionByAnchorType[anchorType].some((item) => item.id === anchorId)) {
    throw new Error('Annotation anchor must reference an existing object.');
  }
}

export function addAnnotation(document, { text, anchorType = 'document', anchorId = null }) {
  if (!text?.trim()) throw new Error('Annotation text is required.');
  assertAnnotationAnchor(document, anchorType, anchorId);
  const next = cloneDocument(document);
  const annotation = { id: createId('note'), text: text.trim(), anchorType, anchorId };
  next.semantic.annotations.push(annotation);
  return next;
}

export function updateAnnotation(document, annotationId, { text, anchorType, anchorId } = {}) {
  const current = document.semantic.annotations.find((annotation) => annotation.id === annotationId);
  if (!current) throw new Error('Annotation does not exist.');
  const nextText = text === undefined ? current.text : text.trim();
  if (!nextText) throw new Error('Annotation text is required.');
  const nextAnchorType = anchorType ?? current.anchorType;
  const nextAnchorId = nextAnchorType === 'document' ? null : anchorId ?? current.anchorId;
  assertAnnotationAnchor(document, nextAnchorType, nextAnchorId);
  const next = cloneDocument(document);
  const annotation = next.semantic.annotations.find((item) => item.id === annotationId);
  annotation.text = nextText;
  annotation.anchorType = nextAnchorType;
  annotation.anchorId = nextAnchorId;
  return next;
}
