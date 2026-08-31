import {
  SCHEMA_VERSION,
  TIMELINE_END_ID,
  TIMELINE_START_ID
} from './constants.js';

let idCounter = 0;

export function createId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36).padStart(4, '0')}`;
}

export function cloneDocument(document) {
  return JSON.parse(JSON.stringify(document));
}

export function createDocument({ title = 'Untitled waveform' } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      title,
      operation: '',
      description: '',
      memoryTechnology: '',
      tags: []
    },
    semantic: {
      signals: [],
      timeline: {
        startMarkerId: TIMELINE_START_ID,
        endMarkerId: TIMELINE_END_ID,
        timeMarkers: []
      },
      stateSegments: [],
      transitions: [],
      timingParameters: [],
      phases: [],
      annotations: []
    },
    presentation: {
      signalRowOrder: [],
      timingLaneOrder: [],
      timingParameterPositions: {},
      collapsedSignalIds: []
    }
  };
}

export function getSignal(document, signalId) {
  return document.semantic.signals.find((signal) => signal.id === signalId) ?? null;
}

export function getMarker(document, markerId) {
  return document.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId) ?? null;
}
