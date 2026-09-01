import {
  ANNOTATION_ANCHOR_TYPES,
  SCHEMA_VERSION,
  SIGNAL_TYPES,
  STATES,
  TIMELINE_END_ID,
  TIMELINE_START_ID
} from './constants.js';
import { assertTimingEndpoints } from './timing-endpoints.js';

function markerSequence(document, markerId) {
  if (markerId === TIMELINE_START_ID) return Number.NEGATIVE_INFINITY;
  if (markerId === TIMELINE_END_ID) return Number.POSITIVE_INFINITY;
  return document.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId)?.sequence ?? Number.NaN;
}

function referencesIn(document) {
  const objects = (items) => items.filter((item) => item && typeof item === 'object');
  return {
    signals: new Map(objects(document.semantic.signals).map((item) => [item.id, item])),
    markers: new Map(objects(document.semantic.timeline.timeMarkers).map((item) => [item.id, item])),
    segments: new Map(objects(document.semantic.stateSegments).map((item) => [item.id, item])),
    transitions: new Map(objects(document.semantic.transitions).map((item) => [item.id, item])),
    timingParameters: new Map(objects(document.semantic.timingParameters).map((item) => [item.id, item])),
    phases: new Map(objects(document.semantic.phases).map((item) => [item.id, item])),
    annotations: new Map(objects(document.semantic.annotations).map((item) => [item.id, item]))
  };
}

function hasUniqueIds(document, errors) {
  const objects = [
    ...document.semantic.signals,
    ...document.semantic.timeline.timeMarkers,
    ...document.semantic.stateSegments,
    ...document.semantic.transitions,
    ...document.semantic.timingParameters,
    ...document.semantic.phases,
    ...document.semantic.annotations
  ];
  const ids = new Set();
  for (const item of objects) {
    if (!item?.id) errors.push('Every semantic object needs an immutable id.');
    else if (ids.has(item.id)) errors.push(`Duplicate object id: ${item.id}`);
    else ids.add(item.id);
  }
}

function validateSignalCoverage(document, refs, errors) {
  for (const signal of document.semantic.signals) {
    if (!SIGNAL_TYPES.includes(signal.type)) errors.push(`Signal ${signal.name} has an unsupported signal type.`);
    const segments = document.semantic.stateSegments
      .filter((segment) => segment.signalId === signal.id)
      .sort((left, right) => markerSequence(document, left.startMarkerId) - markerSequence(document, right.startMarkerId));
    if (!segments.length) {
      errors.push(`Signal ${signal.name} has no state segments.`);
      continue;
    }
    if (segments[0].startMarkerId !== TIMELINE_START_ID || segments.at(-1).endMarkerId !== TIMELINE_END_ID) {
      errors.push(`Signal ${signal.name} segments must cover the complete timeline.`);
    }
    if (segments[0].state !== signal.initialState) errors.push(`Signal ${signal.name} initial state disagrees with its first segment.`);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!STATES.includes(segment.state)) errors.push(`Segment ${segment.id} has an unsupported state.`);
      const start = markerSequence(document, segment.startMarkerId);
      const end = markerSequence(document, segment.endMarkerId);
      if (!(start < end)) errors.push(`Segment ${segment.id} must have a positive left-to-right interval.`);
      if (index && segments[index - 1].endMarkerId !== segment.startMarkerId) {
        errors.push(`Signal ${signal.name} segments must be contiguous without gaps or overlap.`);
      }
    }
  }
  for (const segment of document.semantic.stateSegments) {
    if (!refs.signals.has(segment.signalId)) errors.push(`Segment ${segment.id} references a missing signal.`);
    for (const markerId of [segment.startMarkerId, segment.endMarkerId]) {
      if (markerId !== TIMELINE_START_ID && markerId !== TIMELINE_END_ID && !refs.markers.has(markerId)) {
        errors.push(`Segment ${segment.id} references a missing marker.`);
      }
    }
  }
}

function validateMarkersAndTransitions(document, refs, errors) {
  const seenSequences = new Set();
  const transitionMembership = new Map();
  for (const marker of document.semantic.timeline.timeMarkers) {
    if (!Number.isInteger(marker.sequence)) errors.push(`Marker ${marker.id} needs an integer sequence.`);
    if (seenSequences.has(marker.sequence)) errors.push(`Marker sequence ${marker.sequence} is not unique.`);
    seenSequences.add(marker.sequence);
    if (!Array.isArray(marker.transitionIds) || !marker.transitionIds.length) errors.push(`Marker ${marker.id} may not be empty.`);
    for (const transitionId of marker.transitionIds ?? []) {
      const transition = refs.transitions.get(transitionId);
      if (!transition) errors.push(`Marker ${marker.id} references a missing transition.`);
      else if (transition.markerId !== marker.id) errors.push(`Transition ${transition.id} belongs to a different marker than ${marker.id}.`);
      transitionMembership.set(transitionId, (transitionMembership.get(transitionId) ?? 0) + 1);
    }
  }

  for (const transition of document.semantic.transitions) {
    const marker = refs.markers.get(transition.markerId);
    const [leftId, rightId] = transition.derivedFromSegmentIds ?? [];
    const left = refs.segments.get(leftId);
    const right = refs.segments.get(rightId);
    if (!refs.signals.has(transition.signalId)) errors.push(`Transition ${transition.id} references a missing signal.`);
    if (!marker) errors.push(`Transition ${transition.id} references a missing marker.`);
    if (!left || !right) errors.push(`Transition ${transition.id} references missing segments.`);
    if (marker && !marker.transitionIds.includes(transition.id)) errors.push(`Transition ${transition.id} is absent from its marker.`);
    if ((transitionMembership.get(transition.id) ?? 0) !== 1) errors.push(`Transition ${transition.id} must appear in exactly one marker.`);
    if (left && right) {
      if (left.signalId !== transition.signalId || right.signalId !== transition.signalId || left.endMarkerId !== transition.markerId || right.startMarkerId !== transition.markerId) {
        errors.push(`Transition ${transition.id} does not match its adjacent segments.`);
      }
      if (transition.fromState !== left.state || transition.toState !== right.state || transition.fromState === transition.toState) {
        errors.push(`Transition ${transition.id} state change disagrees with its segments.`);
      }
    }
  }

  for (const signal of document.semantic.signals) {
    const segments = document.semantic.stateSegments
      .filter((segment) => segment.signalId === signal.id)
      .sort((left, right) => markerSequence(document, left.startMarkerId) - markerSequence(document, right.startMarkerId));
    for (let index = 0; index < segments.length - 1; index += 1) {
      const left = segments[index];
      const right = segments[index + 1];
      if (left.state === right.state) continue;
      const derived = document.semantic.transitions.find((transition) => transition.signalId === signal.id && transition.markerId === left.endMarkerId);
      if (!derived) errors.push(`Signal ${signal.name} is missing its derived transition at ${left.endMarkerId}.`);
    }
  }
}

function validateEndpointRelations(document, refs, errors) {
  for (const relation of document.semantic.timingParameters) {
    if ('startTransitionId' in relation || 'endTransitionId' in relation) {
      errors.push(`${relation.name || relation.id} uses deprecated singular timing endpoint fields.`);
    }
    try {
      assertTimingEndpoints(document, relation.startTransitionIds, relation.endTransitionIds);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Timing parameter has invalid endpoints.');
    }
  }
  for (const relation of document.semantic.phases) {
    const start = refs.transitions.get(relation.startTransitionId);
    const end = refs.transitions.get(relation.endTransitionId);
    if (!start || !end) {
      errors.push(`${relation.name || relation.id} references a missing transition endpoint.`);
      continue;
    }
    if (start.id === end.id || !(markerSequence(document, start.markerId) < markerSequence(document, end.markerId))) {
      errors.push(`${relation.name || relation.id} endpoints must be distinct and strictly left-to-right.`);
    }
  }
}

function validateAnnotationsAndPresentation(document, refs, errors) {
  for (const annotation of document.semantic.annotations) {
    if (!ANNOTATION_ANCHOR_TYPES.includes(annotation.anchorType)) errors.push(`Annotation ${annotation.id} has an unsupported anchor type.`);
    if (annotation.anchorType === 'document') continue;
    const collection = annotation.anchorType === 'timingParameter' ? refs.timingParameters : refs[`${annotation.anchorType}s`];
    if (!collection?.has(annotation.anchorId)) errors.push(`Annotation ${annotation.id} references a missing anchor.`);
  }
  for (const signalId of document.presentation?.signalRowOrder ?? []) {
    if (!refs.signals.has(signalId)) errors.push(`Presentation references missing signal ${signalId}.`);
  }
  for (const laneId of document.presentation?.timingLaneOrder ?? []) {
    if (!refs.timingParameters.has(laneId) && !refs.phases.has(laneId)) errors.push(`Presentation references missing lane ${laneId}.`);
  }
  for (const [parameterId, position] of Object.entries(document.presentation?.timingParameterPositions ?? {})) {
    if (!refs.timingParameters.has(parameterId)) errors.push(`Presentation position references missing timing parameter ${parameterId}.`);
    if (!Number.isFinite(position) || position < 0 || position > 1) {
      errors.push(`Timing parameter ${parameterId} position must be between 0 and 1.`);
    }
  }
}

export function validateDocument(document) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== 'object') return { valid: false, errors: ['Document must be an object.'], warnings: [] };
  if (document.schemaVersion !== SCHEMA_VERSION) errors.push(`Unsupported schema version: ${document.schemaVersion ?? '(missing)'}.`);
  if (!document.metadata?.title?.trim()) errors.push('Document metadata.title is required.');
  if (!document.semantic?.timeline || !document.presentation) return { valid: false, errors: [...errors, 'Document semantic and presentation sections are required.'], warnings: [] };
  const requiredCollections = ['signals', 'stateSegments', 'transitions', 'timingParameters', 'phases', 'annotations'];
  for (const collection of requiredCollections) {
    if (!Array.isArray(document.semantic[collection])) errors.push(`semantic.${collection} must be an array.`);
  }
  if (!Array.isArray(document.semantic.timeline.timeMarkers)) errors.push('semantic.timeline.timeMarkers must be an array.');
  if (!Array.isArray(document.presentation.signalRowOrder)) errors.push('presentation.signalRowOrder must be an array.');
  if (!Array.isArray(document.presentation.timingLaneOrder)) errors.push('presentation.timingLaneOrder must be an array.');
  if (document.presentation.timingParameterPositions !== undefined && (
    !document.presentation.timingParameterPositions ||
    typeof document.presentation.timingParameterPositions !== 'object' ||
    Array.isArray(document.presentation.timingParameterPositions)
  )) errors.push('presentation.timingParameterPositions must be an object.');
  const collectionsToCheck = [
    ...requiredCollections.map((name) => [name, document.semantic[name]]),
    ['timeline.timeMarkers', document.semantic.timeline.timeMarkers]
  ];
  for (const [name, items] of collectionsToCheck) {
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) errors.push(`semantic.${name}[${index}] must be an object.`);
    });
  }
  if (errors.length) return { valid: false, errors, warnings: [] };
  if (document.semantic.timeline.startMarkerId !== TIMELINE_START_ID || document.semantic.timeline.endMarkerId !== TIMELINE_END_ID) {
    errors.push('Timeline boundary IDs are immutable.');
  }

  const refs = referencesIn(document);
  hasUniqueIds(document, errors);
  validateSignalCoverage(document, refs, errors);
  validateMarkersAndTransitions(document, refs, errors);
  validateEndpointRelations(document, refs, errors);
  validateAnnotationsAndPresentation(document, refs, errors);
  return { valid: errors.length === 0, errors, warnings };
}
