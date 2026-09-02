import { STATES } from '../domain/constants.js';
import { createDocument } from '../domain/document.js';
import {
  addAnnotation,
  addPhase,
  deleteSignal,
  addSignal,
  addTimingParameter,
  deleteTransitionWithDependencies,
  getMarkerSequence,
  getTransitionDependencies,
  moveMarker,
  moveSignalRow,
  moveTransition,
  rebindTimingEndpoint,
  setTimingParameterPosition,
  setSegmentBoundary,
  updateAnnotation,
  updatePhase,
  updateSignal,
  updateTimingParameter,
  updateTransition
} from '../domain/operations.js';
import { exportDocumentJson, getPngExportPolicy, loadDocumentJson } from '../domain/import-export.js';
import { validateDocument } from '../domain/validate.js';
import { renderSvg, svgToPngBlob } from '../render/svg-renderer.js';
import {
  appendHistoryEntry,
  createHistoryEntry,
  loadHistory,
  replaceActiveHistoryEntry,
  saveHistory,
  selectHistoryEntry
} from './document-history.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function option(value, label, selected = false) {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function tagsFrom(value) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setTimingEndpointNotice(form, endpoint, message = '') {
  const notice = form.querySelector(`[data-endpoint-group="${endpoint}"] [data-endpoint-notice]`);
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
}

function browserStorage(root) {
  try {
    return root.defaultView?.localStorage;
  } catch {
    return null;
  }
}

function anchorOptions(documentModel, selectedAnchor = 'document:') {
  const options = [option('document:', 'Document', selectedAnchor === 'document:')];
  for (const signal of documentModel.semantic.signals) {
    const value = `signal:${signal.id}`;
    options.push(option(value, `Signal · ${signal.name}`, selectedAnchor === value));
  }
  for (const transition of documentModel.semantic.transitions) {
    const value = `transition:${transition.id}`;
    options.push(option(value, `Transition · ${transition.id}`, selectedAnchor === value));
  }
  for (const parameter of documentModel.semantic.timingParameters) {
    const value = `timingParameter:${parameter.id}`;
    options.push(option(value, `Timing · ${parameter.name}`, selectedAnchor === value));
  }
  for (const phase of documentModel.semantic.phases) {
    const value = `phase:${phase.id}`;
    options.push(option(value, `Phase · ${phase.name}`, selectedAnchor === value));
  }
  return options.join('');
}

function transitionOptions(documentModel, selectedId = null) {
  const markerById = new Map(documentModel.semantic.timeline.timeMarkers.map((marker) => [marker.id, marker]));
  return [...documentModel.semantic.transitions]
    .sort((left, right) => markerById.get(left.markerId).sequence - markerById.get(right.markerId).sequence)
    .map((transition) => {
      const signal = documentModel.semantic.signals.find((item) => item.id === transition.signalId);
      const marker = markerById.get(transition.markerId);
      return option(transition.id, `#${marker.sequence} · ${signal?.name ?? transition.signalId} ${transition.fromState}→${transition.toState}`, transition.id === selectedId);
    }).join('');
}

function timingEndpointCheckboxes(documentModel, parameter, endpoint) {
  const ids = parameter[`${endpoint}TransitionIds`];
  const first = documentModel.semantic.transitions.find((item) => item.id === ids[0]);
  const marker = documentModel.semantic.timeline.timeMarkers.find((item) => item.id === first?.markerId);
  const signalOrder = new Map((documentModel.presentation?.signalRowOrder ?? []).map((id, index) => [id, index]));
  const choices = (marker?.transitionIds ?? [])
    .map((id) => documentModel.semantic.transitions.find((item) => item.id === id))
    .filter(Boolean)
    .sort((left, right) => (signalOrder.get(left.signalId) ?? Infinity) - (signalOrder.get(right.signalId) ?? Infinity));
  const checkboxes = choices.map((transition) => {
    const signal = documentModel.semantic.signals.find((item) => item.id === transition.signalId);
    const checked = ids.includes(transition.id) ? ' checked' : '';
    return `<label><input type="checkbox" name="${endpoint}TransitionIds" value="${escapeHtml(transition.id)}" data-slot="${marker?.sequence ?? ''}"${checked} />${escapeHtml(signal?.name ?? transition.signalId)} · ${escapeHtml(`${transition.fromState}→${transition.toState}`)}</label>`;
  }).join('');
  const label = endpoint === 'start' ? 'Start' : 'End';
  const errorId = `timing-endpoint-error-${parameter.id}-${endpoint}`;
  return `<fieldset data-endpoint-group="${endpoint}" data-slot="${marker?.sequence ?? ''}" aria-describedby="${escapeHtml(errorId)}"><legend>${label} endpoint · Order slot #${marker?.sequence ?? '?'}</legend>${checkboxes}<p class="field-error" id="${escapeHtml(errorId)}" role="alert" data-endpoint-notice hidden></p></fieldset>`;
}

export function timingEndpointIdsFromForm(formData, endpoint) {
  return formData.getAll(`${endpoint}TransitionIds`).map(String).filter(Boolean);
}

export function timingEndpointSubmission(formData) {
  const startTransitionIds = timingEndpointIdsFromForm(formData, 'start');
  const endTransitionIds = timingEndpointIdsFromForm(formData, 'end');
  const errors = {
    start: startTransitionIds.length ? '' : 'Select at least one start transition.',
    end: endTransitionIds.length ? '' : 'Select at least one end transition.'
  };
  return {
    shouldUpdate: !errors.start && !errors.end,
    startTransitionIds,
    endTransitionIds,
    errors
  };
}

function updateMetadata(documentModel, values) {
  return {
    ...documentModel,
    metadata: {
      ...documentModel.metadata,
      title: values.title.trim(),
      operation: values.operation.trim(),
      description: values.description.trim(),
      memoryTechnology: values.memoryTechnology.trim(),
      tags: tagsFrom(values.tags)
    }
  };
}

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

export function transitionDependencyDeletePrompt(names) {
  return `This transition is used by: ${names}. Delete the transition? Dependent objects will be updated or removed as required.`;
}

export function sequenceFromPointer(svg, event) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const x = ((event.clientX - rect.left) / rect.width) * viewBox.width;
  return Math.round((x - 170) / 150);
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

export function renderInspectorMarkup(documentModel, selectedTransitionId = null, { openSignalEditorIds = [] } = {}) {
  const selected = documentModel.semantic.transitions.find((transition) => transition.id === selectedTransitionId);
  const dependencies = selected ? getTransitionDependencies(documentModel, selected.id) : null;
  const markersById = new Map(documentModel.semantic.timeline.timeMarkers.map((marker) => [marker.id, marker]));
  const selectedSequence = selected ? markersById.get(selected.markerId)?.sequence : null;
  const signalsById = new Map(documentModel.semantic.signals.map((signal) => [signal.id, signal]));
  const presentedSignalIds = documentModel.presentation?.signalRowOrder?.filter((id) => signalsById.has(id)) ?? [];
  const orderedSignals = [
    ...presentedSignalIds.map((id) => signalsById.get(id)),
    ...documentModel.semantic.signals.filter((signal) => !presentedSignalIds.includes(signal.id))
  ];
  const openSignalIds = new Set(openSignalEditorIds);
  const signalOptions = orderedSignals.map((signal) => option(signal.id, signal.name, signal.id === selected?.signalId)).join('');
  const signalEditors = orderedSignals.map((signal, index) => `
    <details class="relation-editor signal-editor" data-signal-editor-id="${escapeHtml(signal.id)}"${openSignalIds.has(signal.id) ? ' open' : ''}>
      <summary>${escapeHtml(signal.name)} · signal</summary>
      <form class="tool-form" data-form="signal-edit">
        <input type="hidden" name="signalId" value="${escapeHtml(signal.id)}" />
        <label>Name<input name="name" value="${escapeHtml(signal.name)}" required /></label>
        <label>Type<select name="type">${['control', 'power', 'data', 'clock', 'custom'].map((type) => option(type, type, signal.type === type)).join('')}</select></label>
        <label>Initial state<select name="initialState">${STATES.map((item) => option(item, item, signal.initialState === item)).join('')}</select></label>
        <label>Subtype<input name="subtype" value="${escapeHtml(signal.subtype)}" /></label>
        <label>Tags<input name="tags" value="${escapeHtml(signal.tags.join(', '))}" /></label>
        <div class="signal-editor-actions"><button class="button secondary" type="submit">Save</button><button class="button secondary" type="button" data-signal-move="-1" data-signal-id="${escapeHtml(signal.id)}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="button secondary" type="button" data-signal-move="1" data-signal-id="${escapeHtml(signal.id)}" ${index === orderedSignals.length - 1 ? 'disabled' : ''}>↓</button><button class="button danger" type="button" data-delete-signal="${escapeHtml(signal.id)}">Delete</button></div>
      </form>
    </details>`).join('');
  const timingEditors = documentModel.semantic.timingParameters.map((parameter) => `
    <details class="relation-editor">
      <summary>${escapeHtml(parameter.name)} · timing parameter</summary>
      <form class="tool-form" data-form="timing-edit">
        <input type="hidden" name="parameterId" value="${escapeHtml(parameter.id)}" />
        <label>Name<input name="name" value="${escapeHtml(parameter.name)}" required /></label>
        ${timingEndpointCheckboxes(documentModel, parameter, 'start')}
        ${timingEndpointCheckboxes(documentModel, parameter, 'end')}
        <label>Requirement note (optional)<textarea name="requirementText">${escapeHtml(parameter.requirementText)}</textarea></label>
        <label>Tags<input name="tags" value="${escapeHtml((parameter.tags ?? []).join(', '))}" /></label>
        <button class="button secondary" type="submit">Save timing parameter</button>
      </form>
    </details>`).join('');
  const phaseEditors = documentModel.semantic.phases.map((phase) => `
    <details class="relation-editor">
      <summary>${escapeHtml(phase.name)} · phase</summary>
      <form class="tool-form" data-form="phase-edit">
        <input type="hidden" name="phaseId" value="${escapeHtml(phase.id)}" />
        <label>Name<input name="name" value="${escapeHtml(phase.name)}" required /></label>
        <label>Start transition<select name="startTransitionId">${transitionOptions(documentModel, phase.startTransitionId)}</select></label>
        <label>End transition<select name="endTransitionId">${transitionOptions(documentModel, phase.endTransitionId)}</select></label>
        <label>Tags<input name="tags" value="${escapeHtml((phase.tags ?? []).join(', '))}" /></label>
        <button class="button secondary" type="submit">Save phase</button>
      </form>
    </details>`).join('');
  const annotationEditors = documentModel.semantic.annotations.map((annotation) => {
    const selectedAnchor = annotation.anchorType === 'document' ? 'document:' : `${annotation.anchorType}:${annotation.anchorId}`;
    return `
      <details class="relation-editor">
        <summary>Annotation · ${escapeHtml(annotation.text)}</summary>
        <form class="tool-form" data-form="annotation-edit">
          <input type="hidden" name="annotationId" value="${escapeHtml(annotation.id)}" />
          <label>Anchor<select name="anchor">${anchorOptions(documentModel, selectedAnchor)}</select></label>
          <label>Note<textarea name="text" required>${escapeHtml(annotation.text)}</textarea></label>
          <button class="button secondary" type="submit">Save annotation</button>
        </form>
      </details>`;
  }).join('');
  return `
    <h2>Document</h2>
    <form class="tool-form" data-form="metadata">
      <label>Title<input name="title" value="${escapeHtml(documentModel.metadata.title)}" required /></label>
      <label>Operation<input name="operation" value="${escapeHtml(documentModel.metadata.operation)}" /></label>
      <label>Description<textarea name="description">${escapeHtml(documentModel.metadata.description)}</textarea></label>
      <label>Memory technology<input name="memoryTechnology" value="${escapeHtml(documentModel.metadata.memoryTechnology)}" /></label>
      <label>Tags<input name="tags" value="${escapeHtml(documentModel.metadata.tags.join(', '))}" /></label>
      <button class="button secondary" type="submit">Save metadata</button>
    </form>
    <h3>Signals</h3><div class="signal-editor-list">${signalEditors || '<p class="muted">No signals yet.</p>'}</div>
    <h3>Timing parameters</h3><div class="relation-editor-list">${timingEditors || '<p class="muted">No timing parameters yet.</p>'}</div>
    <h3>Phases</h3><div class="relation-editor-list">${phaseEditors || '<p class="muted">No phases yet.</p>'}</div>
    <h3>Annotations</h3><div class="relation-editor-list">${annotationEditors || '<p class="muted">No annotations yet.</p>'}</div>
    ${selected ? `<section class="selection-card"><h3>Edit selected transition</h3><code>${escapeHtml(selected.id)}</code><p>${escapeHtml(`${selected.fromState} → ${selected.toState}`)}</p><form class="tool-form" data-form="transition-edit"><input type="hidden" name="transitionId" value="${escapeHtml(selected.id)}" /><label>Signal<select name="signalId">${signalOptions}</select></label><label>Order slot<input name="sequence" type="number" step="1" value="${escapeHtml(selectedSequence)}" required /></label><label>State after transition<select name="rightState">${STATES.map((item) => option(item, item, selected.toState === item)).join('')}</select></label><button class="button secondary" type="submit">Save transition</button></form><p class="muted">Dependencies: ${dependencies.timingParameters.length} timing, ${dependencies.phases.length} phases</p><button id="delete-transition" class="button danger" type="button">Delete transition</button></section>` : '<p class="muted">Click a transition point to inspect, edit, or delete it.</p>'}`;
}

function historyDisclosureMarkup(history, activeHistoryId) {
  const historyItems = [...history.entries].sort((a, b) => b.updatedAt - a.updatedAt).map((entry) => `
    <button type="button" class="history-item${entry.id === activeHistoryId ? ' active' : ''}" data-history-id="${escapeHtml(entry.id)}">
      <strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(new Date(entry.updatedAt).toLocaleString())}</span>
    </button>`).join('');
  return `<details class="history-disclosure"><summary>Document history <span>${history.entries.length}</span></summary><div class="history-list">${historyItems}</div></details>`;
}

export function renderPaletteMarkup({ documentModel, history, activeHistoryId }) {
  const signals = documentModel.semantic.signals;
  const transitionSelect = transitionOptions(documentModel);
  const signalOptions = signals.map((signal) => option(signal.id, signal.name)).join('');
  const tool = (title, form) => `<details class="tool-disclosure"><summary>${title}</summary>${form}</details>`;
  return `
    ${historyDisclosureMarkup(history, activeHistoryId)}
    <h2>Authoring</h2>
    ${tool('Add signal', `<form class="tool-form" data-form="signal">
      <label>Name<input name="name" required placeholder="WE#" /></label>
      <label>Type<select name="type">${['control', 'power', 'data', 'clock', 'custom'].map((type) => option(type, type)).join('')}</select></label>
      <label>Initial state<select name="initialState">${STATES.map((item) => option(item, item, item === 'LOW')).join('')}</select></label>
      <label>Subtype<input name="subtype" placeholder="write-enable" /></label>
      <label>Tags<input name="tags" placeholder="active-low, write" /></label>
      <button class="button" type="submit">Add signal</button></form>`)}
    ${tool('Add state transition', `<form class="tool-form" data-form="boundary">
      <label>Signal<select name="signalId" ${signals.length ? '' : 'disabled'}>${signalOptions}</select></label>
      <label>Order slot<input name="sequence" type="number" step="1" value="1" required /></label>
      <label>State after transition<select name="rightState">${STATES.map((item) => option(item, item)).join('')}</select></label>
      <button class="button" type="submit" ${signals.length ? '' : 'disabled'}>Add boundary</button></form>`)}
    ${tool('Timing parameter', `<form class="tool-form" data-form="timing">
      <label>Name<input name="name" value="tWP" required /></label>
      <label>Start transition<select name="startTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
      <label>End transition<select name="endTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
      <label>Requirement note (optional)<textarea name="requirementText" placeholder="Datasheet note or timing requirement"></textarea></label>
      <div class="form-actions"><button class="button" type="submit" ${transitionSelect ? '' : 'disabled'}>Add timing</button><button class="button secondary" type="button" data-pick-relation="timing" ${transitionSelect ? '' : 'disabled'}>Pick endpoints</button></div></form>`)}
    ${tool('Phase', `<form class="tool-form" data-form="phase">
      <label>Name<input name="name" value="Program" required /></label>
      <label>Start transition<select name="startTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
      <label>End transition<select name="endTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
      <label>Tags<input name="tags" placeholder="program, write" /></label>
      <div class="form-actions"><button class="button" type="submit" ${transitionSelect ? '' : 'disabled'}>Add phase</button><button class="button secondary" type="button" data-pick-relation="phase" ${transitionSelect ? '' : 'disabled'}>Pick endpoints</button></div></form>`)}
    ${tool('Annotation', `<form class="tool-form" data-form="annotation">
      <label>Anchor<select name="anchor">${anchorOptions(documentModel)}</select></label>
      <label>Note<textarea name="text" required placeholder="Review note"></textarea></label>
      <button class="button" type="submit">Add note</button></form>`)}`;
}

export function renderEditorMarkup(documentModel, { mode, validation, view = 'waveform', repairText = '' }) {
  if (mode === 'repair') {
    return `<section class="repair-mode"><h2>Repair imported JSON</h2><p>The waveform is intentionally not rendered until all validation errors are resolved.</p><textarea id="repair-json" spellcheck="false">${escapeHtml(repairText)}</textarea><button id="repair-apply" class="button" type="button">Validate and apply JSON</button></section>`;
  }
  const policy = getPngExportPolicy(documentModel);
  const errors = validation?.errors ?? [];
  const valid = Boolean(validation?.valid);
  const activeView = valid && view === 'json' ? 'json' : 'waveform';
  const switcher = valid ? `<div class="view-switcher" aria-label="Canvas view"><button type="button" data-editor-view="waveform" class="${activeView === 'waveform' ? 'active' : ''}">Waveform</button><button type="button" data-editor-view="json" class="${activeView === 'json' ? 'active' : ''}">JSON</button></div>` : '';
  const validationSummary = policy.draft ? `<section class="validation-summary" role="alert"><h3>Why this waveform is invalid</h3><p>Fix these ${errors.length} issue${errors.length === 1 ? '' : 's'} before exporting JSON.</p><ol class="error-list">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ol></section>` : '';
  const content = activeView === 'json'
    ? `<pre id="document-json-view">${escapeHtml(exportDocumentJson(documentModel))}</pre>`
    : `<div class="drag-status-slot"><p id="drag-status" class="drag-status" aria-live="polite" hidden></p></div><div id="waveform-canvas">${renderSvg(documentModel, { draft: policy.draft })}</div>`;
  return `<section class="canvas-header"><div><h2>${activeView === 'json' ? 'Current document JSON' : 'Waveform canvas'}</h2><p>${policy.draft ? `Draft rendering: ${errors.length} validation issue${errors.length === 1 ? '' : 's'} need attention before JSON export.` : 'Validated semantic projection.'}</p></div>${switcher}</section>${validationSummary}${content}`;
}

export function bindCanvasPointerEvents(svg, {
  root,
  editor,
  getState,
  applyOperation,
  setNotice,
  render,
  showDragFeedback,
  clearDragFeedback,
  dragMessage
}) {
  svg.addEventListener('pointerdown', (event) => {
    const state = getState();
    const relationEndpoint = event.target.closest('[data-relation-endpoint]');
    const timingRelation = event.target.closest('[data-relation-kind="timing"][data-relation-id]');
    const transition = event.target.closest('[data-transition-id]');
    const marker = event.target.closest('[data-marker-id]');
    if (relationEndpoint) {
      state.drag = {
        kind: 'relation-endpoint',
        relationId: relationEndpoint.dataset.relationId,
        relationKind: relationEndpoint.dataset.relationKind,
        endpoint: relationEndpoint.dataset.relationEndpoint
      };
    } else if (timingRelation) {
      const storedPosition = state.document.presentation?.timingParameterPositions?.[timingRelation.dataset.relationId];
      state.drag = {
        kind: 'timing-position',
        id: timingRelation.dataset.relationId,
        originalY: Number(timingRelation.dataset.relationY),
        grabOffsetY: pointerSvgY(svg, event) - Number(timingRelation.dataset.relationY),
        position: Number.isFinite(storedPosition) ? storedPosition : Number(timingRelation.dataset.timingPosition)
      };
    } else if (transition && state.relationCreation) {
      state.drag = { kind: 'relation-creation' };
    } else if (transition) {
      state.selectedTransitionId = transition.dataset.transitionId;
      state.drag = { kind: 'transition', id: transition.dataset.transitionId };
    } else if (marker) {
      state.drag = { kind: 'marker', id: marker.dataset.markerId };
    } else return;
    svg.setPointerCapture(event.pointerId);
    showDragFeedback(svg, state.drag, relationEndpoint ?? timingRelation ?? transition ?? marker);
    event.stopPropagation();
    event.preventDefault();
  });
  svg.addEventListener('pointermove', (event) => {
    const state = getState();
    if (!state.drag) return;
    const status = editor.querySelector('#drag-status');
    if (state.drag.kind === 'timing-position') {
      const position = timingPositionFromPointer(svg, event, { grabOffsetY: state.drag.grabOffsetY });
      state.drag.position = position;
      const top = Number(svg.dataset.timingTopY);
      const bottom = Number(svg.dataset.timingBottomY);
      const previewY = top + (bottom - top) * position;
      const timingRelation = svg.querySelector(`[data-relation-kind="timing"][data-relation-id="${state.drag.id}"]`);
      timingRelation?.setAttribute('transform', `translate(0 ${previewY - state.drag.originalY})`);
      if (status) status.textContent = dragMessage(state.drag, position);
    } else if (status && (state.drag.kind === 'transition' || state.drag.kind === 'marker')) {
      status.textContent = dragMessage(state.drag, sequenceFromPointer(svg, event));
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
    if (drag.kind === 'timing-position') {
      applyOperation((documentModel) => setTimingParameterPosition(documentModel, { parameterId: drag.id, position: drag.position }));
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
        : addPhase(documentModel, { ...creation.values, tags: tagsFrom(creation.values.tags ?? ''), startTransitionId: creation.firstTransitionId, endTransitionId: targetTransitionId }));
      return;
    }
    const targetSequence = sequenceFromPointer(svg, event);
    applyOperation((documentModel) => drag.kind === 'marker'
      ? moveMarker(documentModel, { markerId: drag.id, targetSequence })
      : moveTransition(documentModel, { transitionId: drag.id, targetSequence }));
  });
  svg.addEventListener('pointercancel', () => {
    const state = getState();
    if (!state.drag) return;
    state.drag = null;
    clearDragFeedback(svg);
    setNotice('Drag cancelled.');
    render();
  });
  svg.addEventListener('dragstart', (event) => event.preventDefault());
}

export function createEditor(root = document) {
  const palette = root.querySelector('#palette');
  const inspector = root.querySelector('#inspector');
  const editor = root.querySelector('#editor');
  const status = root.querySelector('#document-status');
  const exportJsonButton = root.querySelector('#export-json');
  const exportPngButton = root.querySelector('#export-png');
  const importInput = root.querySelector('#import-json');
  const newDocumentButton = root.querySelector('#new-document');
  const initialDocument = createDocument({ title: 'Untitled waveform' });
  const storage = browserStorage(root);
  const initialHistory = loadHistory(storage, createHistoryEntry(initialDocument));
  const initialSelection = selectHistoryEntry(initialHistory.history, initialHistory.history.activeId);
  const state = {
    document: initialSelection.document,
    history: initialSelection.history,
    mode: initialSelection.mode,
    view: 'waveform',
    validation: initialSelection.validation,
    selectedTransitionId: null,
    drag: null,
    relationCreation: null,
    repairSelection: null,
    repairText: initialSelection.repairText,
    notice: initialHistory.notice
  };

  function setNotice(message = '') {
    state.notice = message;
  }

  function refreshValidation() {
    state.validation = state.mode === 'repair'
      ? state.validation
      : validateDocument(state.document);
  }

  function renderPalette() {
    if (state.mode === 'repair') {
      palette.innerHTML = `${historyDisclosureMarkup(state.history, state.history.activeId)}<h2>Repair mode</h2><p class="muted">Imported JSON is not safe to render. Correct it in the raw editor, then apply it again.</p>`;
      return;
    }
    palette.innerHTML = renderPaletteMarkup({ documentModel: state.document, history: state.history, activeHistoryId: state.history.activeId });
  }

  function renderInspector() {
    const openSignalEditorIds = [...inspector.querySelectorAll('details.signal-editor[open][data-signal-editor-id]')]
      .map((element) => element.dataset.signalEditorId);
    if (state.mode === 'repair') {
      const errors = state.validation?.errors ?? ['Unknown import error.'];
      const documentModel = state.document;
      const repairCollectionObjects = (collection, itemPrefix) => {
        const value = documentModel?.semantic?.[collection];
        const items = arrayItems(value);
        return Array.isArray(value)
          ? items.map((item, index) => [`${itemPrefix}:${item?.id ?? index}`, item])
          : value === undefined ? [] : [[collection, value]];
      };
      const repairObjects = [
        ['metadata', documentModel?.metadata],
        ['timeline', documentModel?.semantic?.timeline],
        ...repairCollectionObjects('signals', 'signal'),
        ...repairCollectionObjects('stateSegments', 'segment'),
        ...repairCollectionObjects('transitions', 'transition'),
        ...repairCollectionObjects('timingParameters', 'timing'),
        ...repairCollectionObjects('phases', 'phase'),
        ...repairCollectionObjects('annotations', 'annotation')
      ].filter(([, value]) => value !== undefined);
      const selectedKey = repairObjects.some(([key]) => key === state.repairSelection) ? state.repairSelection : repairObjects[0]?.[0];
      const selectedEntry = repairObjects.find(([key]) => key === selectedKey);
      const selectedObject = selectedEntry ? selectedEntry[1] : documentModel;
      inspector.innerHTML = `<h2>Validation errors</h2><ol class="error-list">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ol><h3>Objects received</h3><div class="repair-object-list">${repairObjects.map(([key]) => `<button type="button" class="button secondary" data-repair-object="${escapeHtml(key)}">${escapeHtml(key)}</button>`).join('') || '<p class="muted">No structured object could be parsed.</p>'}</div><h3>Selected properties</h3><pre class="repair-properties">${escapeHtml(JSON.stringify(selectedObject, null, 2))}</pre>`;
      return;
    }
    inspector.innerHTML = renderInspectorMarkup(state.document, state.selectedTransitionId, { openSignalEditorIds });
  }

  function dragMessage(drag, targetSequence = null) {
    if (drag.kind === 'timing-position') {
      const parameter = state.document.semantic.timingParameters.find((item) => item.id === drag.id);
      const position = targetSequence ?? state.document.presentation?.timingParameterPositions?.[drag.id] ?? 0.2;
      return `Moving timing parameter · ${parameter?.name ?? drag.id}. Vertical position: ${Math.round(position * 100)}%.`;
    }
    const suffix = targetSequence === null ? 'Release to place it.' : `Target order slot: #${targetSequence}.`;
    if (drag.kind === 'transition') {
      const transition = state.document.semantic.transitions.find((item) => item.id === drag.id);
      const signal = state.document.semantic.signals.find((item) => item.id === transition?.signalId);
      return `Moving transition · ${signal?.name ?? transition?.signalId ?? drag.id}. ${suffix}`;
    }
    if (drag.kind === 'marker') {
      const marker = state.document.semantic.timeline.timeMarkers.find((item) => item.id === drag.id);
      return `Moving marker #${marker?.sequence ?? '?'}. All transitions in this column move together. ${suffix}`;
    }
    if (drag.kind === 'relation-endpoint') {
      const relations = drag.relationKind === 'timing' ? state.document.semantic.timingParameters : state.document.semantic.phases;
      const relation = relations.find((item) => item.id === drag.relationId);
      return `Rebinding ${relation?.name ?? drag.relationId} ${drag.endpoint} endpoint. Drop it on a transition.`;
    }
    return 'Selecting a relation endpoint. Drop on a transition.';
  }

  function showDragFeedback(svg, drag, activeElement) {
    const canvas = editor.querySelector('#waveform-canvas');
    canvas?.classList.add('is-dragging');
    svg.classList.add('is-dragging');
    activeElement?.classList.add('is-dragging');
    root.body?.classList.add('waveform-dragging');
    const status = editor.querySelector('#drag-status');
    if (status) {
      status.hidden = false;
      status.textContent = dragMessage(drag);
    }
  }

  function clearDragFeedback(svg) {
    editor.querySelector('#waveform-canvas')?.classList.remove('is-dragging');
    svg.classList.remove('is-dragging');
    svg.querySelectorAll('.is-dragging').forEach((element) => element.classList.remove('is-dragging'));
    root.body?.classList.remove('waveform-dragging');
    const status = editor.querySelector('#drag-status');
    if (status) status.hidden = true;
  }

  function bindCanvasEvents() {
    const svg = editor.querySelector('svg');
    if (!svg) return;
    bindCanvasPointerEvents(svg, {
      root,
      editor,
      getState: () => state,
      applyOperation,
      setNotice,
      render,
      showDragFeedback,
      clearDragFeedback,
      dragMessage
    });
  }

  function renderEditor() {
    editor.innerHTML = renderEditorMarkup(state.document, { mode: state.mode, validation: state.validation, view: state.view, repairText: state.repairText });
    if (state.mode === 'repair') {
      editor.querySelector('#repair-apply').addEventListener('click', () => {
        const text = editor.querySelector('#repair-json').value;
        const outcome = loadDocumentJson(text);
        state.document = outcome.document;
        state.mode = outcome.mode;
        state.validation = outcome.validation;
        state.repairText = text;
        state.view = 'waveform';
        if (outcome.mode === 'editor') {
          state.history = appendHistoryEntry(state.history, createHistoryEntry(state.document));
          saveHistory(storage, state.history);
        }
        setNotice(outcome.mode === 'editor' ? 'JSON repaired and rendered.' : 'JSON is still invalid.');
        render();
      });
      return;
    }
    bindCanvasEvents();
  }

  function persistActiveDocument() {
    state.history = replaceActiveHistoryEntry(state.history, state.document);
    const outcome = saveHistory(storage, state.history);
    if (!outcome.saved) setNotice(outcome.notice);
  }

  function render() {
    refreshValidation();
    renderPalette();
    renderInspector();
    renderEditor();
    const valid = state.mode === 'editor' && state.validation.valid;
    status.textContent = state.mode === 'repair' ? 'Repair mode' : valid ? 'Valid' : 'Draft / invalid';
    status.className = `status-pill ${valid ? 'valid' : 'invalid'}`;
    exportJsonButton.disabled = !valid;
    exportPngButton.disabled = state.mode === 'repair';
    if (state.notice) {
      const message = root.querySelector('#notice') ?? root.body.appendChild(Object.assign(root.createElement('p'), { id: 'notice', className: 'notice' }));
      message.textContent = state.notice;
    }
  }

  function applyOperation(operation) {
    if (state.mode === 'repair') return;
    try {
      state.document = operation(state.document);
      refreshValidation();
      persistActiveDocument();
      setNotice(state.validation.valid ? 'Change applied.' : 'Change applied; resolve validation errors before JSON export.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to apply change.');
    }
    render();
  }

  palette.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const values = formValues(form);
    if (form.dataset.form === 'signal') {
      applyOperation((documentModel) => addSignal(documentModel, { ...values, tags: tagsFrom(values.tags) }));
    } else if (form.dataset.form === 'boundary') {
      applyOperation((documentModel) => setSegmentBoundary(documentModel, { ...values, sequence: Number(values.sequence) }));
    } else if (form.dataset.form === 'timing') {
      applyOperation((documentModel) => addTimingParameter(documentModel, {
        ...values,
        startTransitionIds: [values.startTransitionId],
        endTransitionIds: [values.endTransitionId]
      }));
    } else if (form.dataset.form === 'phase') {
      applyOperation((documentModel) => addPhase(documentModel, { ...values, tags: tagsFrom(values.tags) }));
    } else if (form.dataset.form === 'annotation') {
      const [anchorType, anchorId] = values.anchor.split(':');
      applyOperation((documentModel) => addAnnotation(documentModel, { text: values.text, anchorType, anchorId: anchorId || null }));
    }
  });
  palette.addEventListener('click', (event) => {
    const historyId = event.target.closest('[data-history-id]')?.dataset.historyId;
    if (historyId) {
      const selected = selectHistoryEntry(state.history, historyId);
      state.history = selected.history;
      state.document = selected.document;
      state.mode = selected.mode;
      state.validation = selected.validation;
      state.view = 'waveform';
      state.selectedTransitionId = null;
      state.repairText = selected.repairText;
      saveHistory(storage, state.history);
      const title = state.document?.metadata?.title ?? state.history.entries.find((entry) => entry.id === historyId)?.title ?? 'history document';
      setNotice(selected.mode === 'editor' ? `Opened ${title}.` : `Opened ${title} in repair mode.`);
      render();
      return;
    }
    const button = event.target.closest('[data-pick-relation]');
    if (!button) return;
    const form = button.closest('form');
    state.relationCreation = {
      kind: button.dataset.pickRelation,
      values: formValues(form),
      firstTransitionId: null
    };
    setNotice(`Select the start transition for the ${button.dataset.pickRelation} relation.`);
    render();
  });

  editor.addEventListener('click', (event) => {
    const view = event.target.closest('[data-editor-view]')?.dataset.editorView;
    if (!view || !state.validation?.valid || state.mode !== 'editor') return;
    state.view = view;
    render();
  });

  inspector.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const formData = new FormData(form);
    const values = Object.fromEntries(formData.entries());
    if (form.dataset.form === 'metadata') {
      applyOperation((documentModel) => updateMetadata(documentModel, values));
    } else if (form.dataset.form === 'signal-edit') {
      applyOperation((documentModel) => updateSignal(documentModel, values.signalId, {
        name: values.name,
        type: values.type,
        initialState: values.initialState,
        subtype: values.subtype,
        tags: tagsFrom(values.tags)
      }));
    } else if (form.dataset.form === 'transition-edit') {
      applyOperation((documentModel) => updateTransition(documentModel, values.transitionId, {
        signalId: values.signalId,
        sequence: Number(values.sequence),
        rightState: values.rightState
      }));
    } else if (form.dataset.form === 'timing-edit') {
      const submission = timingEndpointSubmission(formData);
      if (!submission.shouldUpdate) {
        setTimingEndpointNotice(form, 'start', submission.errors.start);
        setTimingEndpointNotice(form, 'end', submission.errors.end);
        return;
      }
      setTimingEndpointNotice(form, 'start');
      setTimingEndpointNotice(form, 'end');
      applyOperation((documentModel) => updateTimingParameter(documentModel, values.parameterId, {
        name: values.name,
        startTransitionIds: submission.startTransitionIds,
        endTransitionIds: submission.endTransitionIds,
        requirementText: values.requirementText,
        tags: tagsFrom(values.tags)
      }));
    } else if (form.dataset.form === 'phase-edit') {
      applyOperation((documentModel) => updatePhase(documentModel, values.phaseId, {
        name: values.name,
        startTransitionId: values.startTransitionId,
        endTransitionId: values.endTransitionId,
        tags: tagsFrom(values.tags)
      }));
    } else if (form.dataset.form === 'annotation-edit') {
      const [anchorType, anchorId] = values.anchor.split(':');
      applyOperation((documentModel) => updateAnnotation(documentModel, values.annotationId, {
        text: values.text,
        anchorType,
        anchorId: anchorId || null
      }));
    }
  });
  inspector.addEventListener('click', (event) => {
    if (state.mode === 'repair' && event.target.dataset.repairObject) {
      state.repairSelection = event.target.dataset.repairObject;
      render();
      return;
    }
    if (event.target.id === 'delete-transition' && state.selectedTransitionId) {
      const dependencies = getTransitionDependencies(state.document, state.selectedTransitionId);
      const names = [...dependencies.timingParameters, ...dependencies.phases].map((item) => item.name).join(', ');
      const cascade = !names || window.confirm(transitionDependencyDeletePrompt(names));
      if (!cascade) return;
      applyOperation((documentModel) => {
        const outcome = deleteTransitionWithDependencies(documentModel, state.selectedTransitionId, { cascade: Boolean(names) });
        if (!outcome.deleted) throw new Error('Transition still has dependencies.');
        state.selectedTransitionId = null;
        return outcome.document;
      });
      return;
    }
    const signalId = event.target.dataset.deleteSignal;
    if (signalId) {
      if (!window.confirm('Delete this signal, its waveform segments, transitions, and dependent timing objects?')) return;
      applyOperation((documentModel) => deleteSignal(documentModel, signalId));
      state.selectedTransitionId = null;
      return;
    }
    const signalMove = event.target.dataset.signalMove;
    if (signalMove !== undefined) {
      const rowOrder = state.document.presentation.signalRowOrder;
      const currentIndex = rowOrder.indexOf(event.target.dataset.signalId);
      applyOperation((documentModel) => moveSignalRow(documentModel, {
        signalId: event.target.dataset.signalId,
        targetIndex: currentIndex + Number(signalMove)
      }));
    }
  });

  exportJsonButton.addEventListener('click', () => {
    try {
      downloadBlob(new Blob([exportDocumentJson(state.document)], { type: 'application/json' }), 'waveform.json');
      setNotice('Validated JSON exported.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'JSON export failed.');
      render();
    }
  });
  exportPngButton.addEventListener('click', async () => {
    try {
      if (state.view === 'json') {
        state.view = 'waveform';
        render();
      }
      const svg = editor.querySelector('svg');
      downloadBlob(await svgToPngBlob(svg), 'waveform.png');
      setNotice(getPngExportPolicy(state.document).draft ? 'Draft PNG exported with watermark.' : 'PNG exported.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'PNG export failed.');
    }
  });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    const outcome = loadDocumentJson(text);
    state.document = outcome.document;
    state.mode = outcome.mode;
    state.validation = outcome.validation;
    state.repairText = text;
    state.view = 'waveform';
    state.selectedTransitionId = null;
    if (outcome.mode === 'editor') {
      const entry = createHistoryEntry(state.document);
      state.history = appendHistoryEntry(state.history, entry);
      saveHistory(storage, state.history);
    }
    setNotice(outcome.mode === 'editor' ? 'JSON imported.' : 'Imported JSON needs repair before rendering.');
    render();
    importInput.value = '';
  });
  newDocumentButton.addEventListener('click', () => {
    if (!window.confirm('Start a new waveform document? The current document remains available in history.')) return;
    state.document = createDocument({ title: 'Untitled waveform' });
    state.history = appendHistoryEntry(state.history, createHistoryEntry(state.document));
    saveHistory(storage, state.history);
    state.mode = 'editor';
    state.view = 'waveform';
    state.selectedTransitionId = null;
    setNotice('Created a new waveform document.');
    render();
  });

  render();
  return { getState: () => ({ ...state }), render };
}
