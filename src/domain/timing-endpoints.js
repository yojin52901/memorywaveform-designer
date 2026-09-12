export function resolveTimingEndpoint(document, transitionIds, label = 'Timing endpoint') {
  if (!Array.isArray(transitionIds) || transitionIds.length === 0) throw new Error(`${label} must reference at least one transition.`);
  if (new Set(transitionIds).size !== transitionIds.length) throw new Error(`${label} may not contain duplicate transitions.`);
  const transitions = transitionIds.map((id) => document.semantic.transitions.find((item) => item.id === id));
  if (transitions.some((item) => !item)) throw new Error(`${label} references a missing transition.`);
  const markerIds = new Set(transitions.map((item) => item.markerId));
  if (markerIds.size !== 1) throw new Error(`${label} transitions must share one order slot.`);
  const markerId = transitions[0].markerId;
  const sequence = document.semantic.timeline.timeMarkers.find((marker) => marker.id === markerId)?.sequence;
  if (!Number.isInteger(sequence)) throw new Error(`${label} references a missing order slot.`);
  return { transitions, markerId, sequence };
}

export function assertTimingEndpoints(document, startTransitionIds, endTransitionIds) {
  const start = resolveTimingEndpoint(document, startTransitionIds, 'Start endpoint');
  const end = resolveTimingEndpoint(document, endTransitionIds, 'End endpoint');
  if (!(start.sequence < end.sequence)) throw new Error('Timing endpoints must be strictly left-to-right.');
}

export function timingParameterReferencesTransition(parameter, transitionId) {
  return parameter.startTransitionIds.includes(transitionId) || parameter.endTransitionIds.includes(transitionId);
}
