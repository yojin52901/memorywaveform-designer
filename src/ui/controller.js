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
  setSegmentBoundary,
  updatePhase,
  updateSignal,
  updateTimingParameter
} from '../domain/operations.js';
import { exportDocumentJson, getPngExportPolicy, loadDocumentJson } from '../domain/import-export.js';
import { validateDocument } from '../domain/validate.js';
import { renderSvg, svgToPngBlob } from '../render/svg-renderer.js';

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

function anchorOptions(documentModel) {
  const options = [option('document:', 'Document')];
  for (const signal of documentModel.semantic.signals) options.push(option(`signal:${signal.id}`, `Signal · ${signal.name}`));
  for (const transition of documentModel.semantic.transitions) options.push(option(`transition:${transition.id}`, `Transition · ${transition.id}`));
  for (const parameter of documentModel.semantic.timingParameters) options.push(option(`timingParameter:${parameter.id}`, `Timing · ${parameter.name}`));
  for (const phase of documentModel.semantic.phases) options.push(option(`phase:${phase.id}`, `Phase · ${phase.name}`));
  return options.join('');
}

function transitionOptions(documentModel) {
  const markerById = new Map(documentModel.semantic.timeline.timeMarkers.map((marker) => [marker.id, marker]));
  return [...documentModel.semantic.transitions]
    .sort((left, right) => markerById.get(left.markerId).sequence - markerById.get(right.markerId).sequence)
    .map((transition) => {
      const signal = documentModel.semantic.signals.find((item) => item.id === transition.signalId);
      const marker = markerById.get(transition.markerId);
      return option(transition.id, `#${marker.sequence} · ${signal?.name ?? transition.signalId} ${transition.fromState}→${transition.toState}`);
    }).join('');
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

export function createEditor(root = document) {
  const palette = root.querySelector('#palette');
  const inspector = root.querySelector('#inspector');
  const editor = root.querySelector('#editor');
  const status = root.querySelector('#document-status');
  const exportJsonButton = root.querySelector('#export-json');
  const exportPngButton = root.querySelector('#export-png');
  const importInput = root.querySelector('#import-json');
  const newDocumentButton = root.querySelector('#new-document');
  const state = {
    document: createDocument({ title: 'Untitled waveform' }),
    mode: 'editor',
    validation: null,
    selectedTransitionId: null,
    drag: null,
    relationCreation: null,
    repairSelection: null,
    repairText: '',
    notice: ''
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
      palette.innerHTML = `<h2>Repair mode</h2><p class="muted">Imported JSON is not safe to render. Correct it in the raw editor, then apply it again.</p>`;
      return;
    }
    const signals = state.document.semantic.signals;
    const transitionSelect = transitionOptions(state.document);
    const signalOptions = signals.map((signal) => option(signal.id, signal.name)).join('');
    palette.innerHTML = `
      <h2>Authoring</h2>
      <form class="tool-form" data-form="signal"><h3>Add signal</h3>
        <label>Name<input name="name" required placeholder="WE#" /></label>
        <label>Type<select name="type">${['control', 'power', 'data', 'clock', 'custom'].map((type) => option(type, type)).join('')}</select></label>
        <label>Initial state<select name="initialState">${STATES.map((item) => option(item, item, item === 'LOW')).join('')}</select></label>
        <label>Subtype<input name="subtype" placeholder="write-enable" /></label>
        <label>Tags<input name="tags" placeholder="active-low, write" /></label>
        <button class="button" type="submit">Add signal</button>
      </form>
      <form class="tool-form" data-form="boundary"><h3>Add state transition</h3>
        <label>Signal<select name="signalId" ${signals.length ? '' : 'disabled'}>${signalOptions}</select></label>
        <label>Order slot<input name="sequence" type="number" step="1" value="10" required /></label>
        <label>State after transition<select name="rightState">${STATES.map((item) => option(item, item)).join('')}</select></label>
        <button class="button" type="submit" ${signals.length ? '' : 'disabled'}>Add boundary</button>
      </form>
      <form class="tool-form" data-form="timing"><h3>Timing parameter</h3>
        <label>Name<input name="name" value="tWP" required /></label>
        <label>Start transition<select name="startTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
        <label>End transition<select name="endTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
        <label>Requirement DSL<input name="requirementText" value=">= 20 ns" required /></label>
        <div class="form-actions"><button class="button" type="submit" ${transitionSelect ? '' : 'disabled'}>Add timing</button><button class="button secondary" type="button" data-pick-relation="timing" ${transitionSelect ? '' : 'disabled'}>Pick endpoints</button></div>
      </form>
      <form class="tool-form" data-form="phase"><h3>Phase</h3>
        <label>Name<input name="name" value="Program" required /></label>
        <label>Start transition<select name="startTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
        <label>End transition<select name="endTransitionId" ${transitionSelect ? '' : 'disabled'}>${transitionSelect}</select></label>
        <label>Tags<input name="tags" placeholder="program, write" /></label>
        <div class="form-actions"><button class="button" type="submit" ${transitionSelect ? '' : 'disabled'}>Add phase</button><button class="button secondary" type="button" data-pick-relation="phase" ${transitionSelect ? '' : 'disabled'}>Pick endpoints</button></div>
      </form>
      <form class="tool-form" data-form="annotation"><h3>Annotation</h3>
        <label>Anchor<select name="anchor">${anchorOptions(state.document)}</select></label>
        <label>Note<textarea name="text" required placeholder="Review note"></textarea></label>
        <button class="button" type="submit">Add note</button>
      </form>`;
  }

  function renderInspector() {
    if (state.mode === 'repair') {
      const errors = state.validation?.errors ?? ['Unknown import error.'];
      const documentModel = state.document;
      const repairObjects = [
        ['metadata', documentModel?.metadata],
        ['timeline', documentModel?.semantic?.timeline],
        ...(documentModel?.semantic?.signals ?? []).map((item, index) => [`signal:${item?.id ?? index}`, item]),
        ...(documentModel?.semantic?.stateSegments ?? []).map((item, index) => [`segment:${item?.id ?? index}`, item]),
        ...(documentModel?.semantic?.transitions ?? []).map((item, index) => [`transition:${item?.id ?? index}`, item]),
        ...(documentModel?.semantic?.timingParameters ?? []).map((item, index) => [`timing:${item?.id ?? index}`, item]),
        ...(documentModel?.semantic?.phases ?? []).map((item, index) => [`phase:${item?.id ?? index}`, item]),
        ...(documentModel?.semantic?.annotations ?? []).map((item, index) => [`annotation:${item?.id ?? index}`, item])
      ].filter(([, value]) => value !== undefined);
      const selectedKey = repairObjects.some(([key]) => key === state.repairSelection) ? state.repairSelection : repairObjects[0]?.[0];
      const selectedObject = repairObjects.find(([key]) => key === selectedKey)?.[1] ?? documentModel;
      inspector.innerHTML = `<h2>Validation errors</h2><ol class="error-list">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ol><h3>Objects received</h3><div class="repair-object-list">${repairObjects.map(([key]) => `<button type="button" class="button secondary" data-repair-object="${escapeHtml(key)}">${escapeHtml(key)}</button>`).join('') || '<p class="muted">No structured object could be parsed.</p>'}</div><h3>Selected properties</h3><pre class="repair-properties">${escapeHtml(JSON.stringify(selectedObject, null, 2))}</pre>`;
      return;
    }
    const selected = state.document.semantic.transitions.find((transition) => transition.id === state.selectedTransitionId);
    const dependencies = selected ? getTransitionDependencies(state.document, selected.id) : null;
    inspector.innerHTML = `
      <h2>Document</h2>
      <form class="tool-form" data-form="metadata">
        <label>Title<input name="title" value="${escapeHtml(state.document.metadata.title)}" required /></label>
        <label>Operation<input name="operation" value="${escapeHtml(state.document.metadata.operation)}" /></label>
        <label>Description<textarea name="description">${escapeHtml(state.document.metadata.description)}</textarea></label>
        <label>Memory technology<input name="memoryTechnology" value="${escapeHtml(state.document.metadata.memoryTechnology)}" /></label>
        <label>Tags<input name="tags" value="${escapeHtml(state.document.metadata.tags.join(', '))}" /></label>
        <button class="button secondary" type="submit">Save metadata</button>
      </form>
      <h3>Signals</h3><div class="signal-editor-list">${state.document.semantic.signals.map((signal, index) => `<form class="signal-editor" data-form="signal-edit"><input type="hidden" name="signalId" value="${escapeHtml(signal.id)}" /><label>Name<input name="name" value="${escapeHtml(signal.name)}" required /></label><label>Type<select name="type">${['control', 'power', 'data', 'clock', 'custom'].map((type) => option(type, type, signal.type === type)).join('')}</select></label><label>Subtype<input name="subtype" value="${escapeHtml(signal.subtype)}" /></label><label>Tags<input name="tags" value="${escapeHtml(signal.tags.join(', '))}" /></label><p class="muted">Initial: ${escapeHtml(signal.initialState)}</p><div class="signal-editor-actions"><button class="button secondary" type="submit">Save</button><button class="button secondary" type="button" data-signal-move="-1" data-signal-id="${escapeHtml(signal.id)}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="button secondary" type="button" data-signal-move="1" data-signal-id="${escapeHtml(signal.id)}" ${index === state.document.semantic.signals.length - 1 ? 'disabled' : ''}>↓</button><button class="button danger" type="button" data-delete-signal="${escapeHtml(signal.id)}">Delete</button></div></form>`).join('') || '<p class="muted">No signals yet.</p>'}</div>
      ${selected ? `<section class="selection-card"><h3>Selected transition</h3><code>${escapeHtml(selected.id)}</code><p>${escapeHtml(`${selected.fromState} → ${selected.toState}`)}</p><p class="muted">Dependencies: ${dependencies.timingParameters.length} timing, ${dependencies.phases.length} phases</p><button id="delete-transition" class="button danger" type="button">Delete transition</button></section>` : '<p class="muted">Click a transition point to inspect or delete it.</p>'}`;
  }

  function bindCanvasEvents() {
    const svg = editor.querySelector('svg');
    if (!svg) return;
    svg.addEventListener('pointerdown', (event) => {
      const relationEndpoint = event.target.closest('[data-relation-endpoint]');
      const transition = event.target.closest('[data-transition-id]');
      const marker = event.target.closest('[data-marker-id]');
      if (relationEndpoint) {
        state.drag = {
          kind: 'relation-endpoint',
          relationId: relationEndpoint.dataset.relationId,
          relationKind: relationEndpoint.dataset.relationKind,
          endpoint: relationEndpoint.dataset.relationEndpoint
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
      event.preventDefault();
    });
    svg.addEventListener('pointerup', (event) => {
      if (!state.drag) return;
      const drag = state.drag;
      state.drag = null;
      if (drag.kind === 'relation-endpoint') {
        const targetTransitionId = resolveDropTransitionId(root, event.clientX, event.clientY);
        if (!targetTransitionId) {
          setNotice('Drop a relation endpoint on a transition point.');
          render();
          return;
        }
        applyOperation((documentModel) => {
          const updates = drag.endpoint === 'start' ? { startTransitionId: targetTransitionId } : { endTransitionId: targetTransitionId };
          return drag.relationKind === 'timing'
            ? updateTimingParameter(documentModel, drag.relationId, updates)
            : updatePhase(documentModel, drag.relationId, updates);
        });
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
          ? addTimingParameter(documentModel, { ...creation.values, startTransitionId: creation.firstTransitionId, endTransitionId: targetTransitionId })
          : addPhase(documentModel, { ...creation.values, tags: tagsFrom(creation.values.tags ?? ''), startTransitionId: creation.firstTransitionId, endTransitionId: targetTransitionId }));
        return;
      }
      const targetSequence = sequenceFromPointer(svg, event);
      applyOperation((documentModel) => drag.kind === 'marker'
        ? moveMarker(documentModel, { markerId: drag.id, targetSequence })
        : moveTransition(documentModel, { transitionId: drag.id, targetSequence }));
    });
  }

  function sequenceFromPointer(svg, event) {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const x = ((event.clientX - rect.left) / rect.width) * viewBox.width;
    return Math.round((x - 170) / 150) * 10;
  }

  function renderEditor() {
    if (state.mode === 'repair') {
      editor.innerHTML = `<section class="repair-mode"><h2>Repair imported JSON</h2><p>The waveform is intentionally not rendered until all validation errors are resolved.</p><textarea id="repair-json" spellcheck="false">${escapeHtml(state.repairText)}</textarea><button id="repair-apply" class="button" type="button">Validate and apply JSON</button></section>`;
      editor.querySelector('#repair-apply').addEventListener('click', () => {
        const text = editor.querySelector('#repair-json').value;
        const outcome = loadDocumentJson(text);
        state.document = outcome.document;
        state.mode = outcome.mode;
        state.validation = outcome.validation;
        state.repairText = text;
        setNotice(outcome.mode === 'editor' ? 'JSON repaired and rendered.' : 'JSON is still invalid.');
        render();
      });
      return;
    }
    const policy = getPngExportPolicy(state.document);
    editor.innerHTML = `<section class="canvas-header"><div><h2>Waveform canvas</h2><p>${policy.draft ? 'Draft rendering: fix validation errors before JSON export.' : 'Validated semantic projection.'}</p></div><p class="drag-hint">Drag a transition or marker column to adjust sequence.</p></section><div id="waveform-canvas">${renderSvg(state.document, { draft: policy.draft })}</div>`;
    bindCanvasEvents();
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
      applyOperation((documentModel) => addTimingParameter(documentModel, values));
    } else if (form.dataset.form === 'phase') {
      applyOperation((documentModel) => addPhase(documentModel, { ...values, tags: tagsFrom(values.tags) }));
    } else if (form.dataset.form === 'annotation') {
      const [anchorType, anchorId] = values.anchor.split(':');
      applyOperation((documentModel) => addAnnotation(documentModel, { text: values.text, anchorType, anchorId: anchorId || null }));
    }
  });
  palette.addEventListener('click', (event) => {
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

  inspector.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const values = formValues(form);
    if (form.dataset.form === 'metadata') {
      applyOperation((documentModel) => updateMetadata(documentModel, values));
    } else if (form.dataset.form === 'signal-edit') {
      applyOperation((documentModel) => updateSignal(documentModel, values.signalId, {
        name: values.name,
        type: values.type,
        subtype: values.subtype,
        tags: tagsFrom(values.tags)
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
      const cascade = !names || window.confirm(`This transition is used by: ${names}. Delete the transition and these dependent objects?`);
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
    state.selectedTransitionId = null;
    setNotice(outcome.mode === 'editor' ? 'JSON imported.' : 'Imported JSON needs repair before rendering.');
    render();
    importInput.value = '';
  });
  newDocumentButton.addEventListener('click', () => {
    if (!window.confirm('Start a new waveform document? Unsaved in-browser changes will be discarded.')) return;
    state.document = createDocument({ title: 'Untitled waveform' });
    state.mode = 'editor';
    state.selectedTransitionId = null;
    setNotice('Created a new waveform document.');
    render();
  });

  render();
  return { getState: () => ({ ...state }), render };
}
