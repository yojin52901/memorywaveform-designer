export function orderedSignals(documentModel) {
  const signalsById = new Map(documentModel.semantic.signals.map((signal) => [signal.id, signal]));
  const presented = (documentModel.presentation?.signalRowOrder ?? []).filter((id) => signalsById.has(id));
  return [
    ...presented.map((id) => signalsById.get(id)),
    ...documentModel.semantic.signals.filter((signal) => !presented.includes(signal.id))
  ];
}

export function transitionOptions(documentModel) {
  const markerById = new Map(documentModel.semantic.timeline.timeMarkers.map((marker) => [marker.id, marker]));
  const signalById = new Map(documentModel.semantic.signals.map((signal) => [signal.id, signal]));
  return [...documentModel.semantic.transitions]
    .sort((left, right) => (markerById.get(left.markerId)?.sequence ?? 0) - (markerById.get(right.markerId)?.sequence ?? 0))
    .map((transition) => ({
      value: transition.id,
      label: `#${markerById.get(transition.markerId)?.sequence ?? '?'} · ${signalById.get(transition.signalId)?.name ?? transition.signalId} ${transition.fromState}→${transition.toState}`
    }));
}

export function markerSequence(documentModel, transitionId) {
  const transition = documentModel.semantic.transitions.find((item) => item.id === transitionId);
  const marker = documentModel.semantic.timeline.timeMarkers.find((item) => item.id === transition?.markerId);
  return marker?.sequence ?? null;
}

export function anchorOptions(documentModel) {
  return [
    { value: 'document:', label: 'Document' },
    ...documentModel.semantic.signals.map((signal) => ({ value: `signal:${signal.id}`, label: `Signal · ${signal.name}` })),
    ...documentModel.semantic.transitions.map((transition) => ({ value: `transition:${transition.id}`, label: `Transition · ${transition.id}` })),
    ...documentModel.semantic.timingParameters.map((parameter) => ({ value: `timingParameter:${parameter.id}`, label: `Timing · ${parameter.name}` })),
    ...documentModel.semantic.phases.map((phase) => ({ value: `phase:${phase.id}`, label: `Phase · ${phase.name}` }))
  ];
}

export function endpointChoices(documentModel, parameter, endpoint) {
  const ids = parameter[`${endpoint}TransitionIds`] ?? [];
  const first = documentModel.semantic.transitions.find((transition) => transition.id === ids[0]);
  const marker = documentModel.semantic.timeline.timeMarkers.find((item) => item.id === first?.markerId);
  const signalOrder = new Map(orderedSignals(documentModel).map((signal, index) => [signal.id, index]));
  return (marker?.transitionIds ?? [])
    .map((id) => documentModel.semantic.transitions.find((transition) => transition.id === id))
    .filter(Boolean)
    .sort((left, right) => (signalOrder.get(left.signalId) ?? Infinity) - (signalOrder.get(right.signalId) ?? Infinity))
    .map((transition) => {
      const signal = documentModel.semantic.signals.find((item) => item.id === transition.signalId);
      return { value: transition.id, label: `${signal?.name ?? transition.signalId} · ${transition.fromState}→${transition.toState}` };
    });
}

export function splitAnchor(value) {
  const [anchorType, ...id] = String(value ?? 'document:').split(':');
  return { anchorType, anchorId: id.join(':') || null };
}
