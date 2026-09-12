import { createDocument } from '../domain/document.js';
import { createExampleDocument } from '../domain/example-document.js';
import { loadDocumentJson } from '../domain/import-export.js';
import { validateDocument } from '../domain/validate.js';
import {
  appendHistoryEntry,
  createHistoryEntry,
  deleteHistoryEntry,
  loadHistory,
  replaceActiveHistoryEntry,
  selectHistoryEntry
} from '../ui/document-history.js';

export function splitTags(value = '') {
  return String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
}

export function updateDocumentMetadata(documentModel, values) {
  return {
    ...documentModel,
    metadata: {
      ...documentModel.metadata,
      title: String(values.title ?? '').trim(),
      operation: String(values.operation ?? '').trim(),
      description: String(values.description ?? '').trim(),
      memoryTechnology: String(values.memoryTechnology ?? '').trim(),
      tags: splitTags(values.tags)
    }
  };
}

export function createInitialEditorState(storage) {
  const initialDocument = createDocument({ title: 'Untitled waveform' });
  const loaded = loadHistory(storage, createHistoryEntry(initialDocument));
  const selected = selectHistoryEntry(loaded.history, loaded.history.activeId);
  return {
    document: selected.document,
    history: selected.history,
    mode: selected.mode,
    view: 'waveform',
    validation: selected.validation,
    selectedTransitionId: null,
    drag: null,
    relationCreation: null,
    repairSelection: null,
    repairText: selected.repairText,
    notice: loaded.notice,
    renderRevision: 0
  };
}

export function runEditorOperation(state, operation) {
  if (state.mode === 'repair') return state;
  try {
    const document = operation(state.document);
    const validation = validateDocument(document);
    return {
      ...state,
      document,
      validation,
      history: replaceActiveHistoryEntry(state.history, document),
      notice: validation.valid ? 'Change applied.' : 'Change applied; resolve validation errors before JSON export.'
    };
  } catch (error) {
    return { ...state, notice: error instanceof Error ? error.message : 'Unable to apply change.' };
  }
}

export function withImportedJson(state, text) {
  const outcome = loadDocumentJson(text);
  const next = {
    ...state,
    document: outcome.document,
    mode: outcome.mode,
    validation: outcome.validation,
    repairText: text,
    view: 'waveform',
    selectedTransitionId: null,
    relationCreation: null,
    repairSelection: null,
    drag: null,
    notice: outcome.mode === 'editor' ? 'JSON imported.' : 'Imported JSON needs repair before rendering.'
  };
  return outcome.mode === 'editor'
    ? { ...next, history: appendHistoryEntry(state.history, createHistoryEntry(outcome.document)) }
    : next;
}

export function withRepairJson(state, text) {
  const outcome = withImportedJson(state, text);
  return {
    ...outcome,
    notice: outcome.mode === 'editor' ? 'JSON repaired and rendered.' : 'JSON is still invalid.'
  };
}

export function withExampleDocument(state) {
  const document = createExampleDocument();
  const history = appendHistoryEntry(
    state.mode === 'editor' ? replaceActiveHistoryEntry(state.history, state.document) : state.history,
    createHistoryEntry(document)
  );
  return {
    ...state,
    document,
    history,
    mode: 'editor',
    validation: validateDocument(document),
    view: 'waveform',
    selectedTransitionId: null,
    relationCreation: null,
    repairSelection: null,
    repairText: '',
    drag: null,
    notice: 'Opened a fresh example copy. Your previous document remains in history.'
  };
}

export function withNewDocument(state) {
  const document = createDocument({ title: 'Untitled waveform' });
  return {
    ...state,
    document,
    history: appendHistoryEntry(state.history, createHistoryEntry(document)),
    mode: 'editor',
    validation: validateDocument(document),
    view: 'waveform',
    selectedTransitionId: null,
    relationCreation: null,
    repairSelection: null,
    repairText: '',
    drag: null,
    notice: 'Created a new waveform document.'
  };
}

export function withHistorySelection(state, historyId) {
  try {
    const selected = selectHistoryEntry(state.history, historyId);
    const title = selected.document?.metadata?.title ?? 'history document';
    return {
      ...state,
      document: selected.document,
      history: selected.history,
      mode: selected.mode,
      validation: selected.validation,
      view: 'waveform',
      selectedTransitionId: null,
      relationCreation: null,
      repairSelection: null,
      repairText: selected.repairText,
      drag: null,
      notice: selected.mode === 'editor' ? `Opened ${title}.` : `Opened ${title} in repair mode.`
    };
  } catch (error) {
    return { ...state, notice: error instanceof Error ? error.message : 'History document was not found.' };
  }
}

export function withHistoryDeletion(state, historyId) {
  try {
    const entry = state.history.entries.find((item) => item.id === historyId);
    if (!entry) throw new Error('History document was not found.');
    let history = deleteHistoryEntry(state.history, historyId);
    if (!history.entries.length) {
      history = appendHistoryEntry(history, createHistoryEntry(createDocument({ title: 'Untitled waveform' })));
    }
    const selected = selectHistoryEntry(history, history.activeId);
    return {
      ...state,
      document: selected.document,
      history: selected.history,
      mode: selected.mode,
      validation: selected.validation,
      view: 'waveform',
      selectedTransitionId: null,
      relationCreation: null,
      repairSelection: null,
      repairText: selected.repairText,
      drag: null,
      notice: `Deleted ${entry.title} from document history.`
    };
  } catch (error) {
    return { ...state, notice: error instanceof Error ? error.message : 'Unable to delete history document.' };
  }
}

export function repairObjects(documentModel) {
  const collectionObjects = (collection, itemPrefix) => {
    const value = documentModel?.semantic?.[collection];
    if (Array.isArray(value)) return value.map((item, index) => [`${itemPrefix}:${item?.id ?? index}`, item]);
    return value === undefined ? [] : [[collection, value]];
  };

  return [
    ['metadata', documentModel?.metadata],
    ['timeline', documentModel?.semantic?.timeline],
    ...collectionObjects('signals', 'signal'),
    ...collectionObjects('stateSegments', 'segment'),
    ...collectionObjects('transitions', 'transition'),
    ...collectionObjects('timingParameters', 'timing'),
    ...collectionObjects('phases', 'phase'),
    ...collectionObjects('annotations', 'annotation')
  ].filter(([, value]) => value !== undefined);
}
