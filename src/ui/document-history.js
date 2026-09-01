import { cloneDocument } from '../domain/document.js';
import { loadDocumentJson } from '../domain/import-export.js';

export const HISTORY_STORAGE_KEY = 'memorywaveform-designer.history.v1';

function cloneEntry(entry) {
  return { ...entry, snapshot: cloneDocument(entry.snapshot) };
}

export function createHistoryEntry(snapshot, { id = globalThis.crypto?.randomUUID?.() ?? `doc-${Date.now()}`, now = Date.now() } = {}) {
  return { id, title: snapshot.metadata?.title || 'Untitled waveform', updatedAt: now, snapshot: cloneDocument(snapshot) };
}

export function createHistoryState(entry) {
  return { activeId: entry.id, entries: [cloneEntry(entry)] };
}

export function replaceActiveHistoryEntry(history, snapshot, now = Date.now()) {
  const entries = history.entries.map((entry) => entry.id === history.activeId
    ? createHistoryEntry(snapshot, { id: entry.id, now })
    : cloneEntry(entry));
  return { activeId: history.activeId, entries };
}

export function appendHistoryEntry(history, entry) {
  return { activeId: entry.id, entries: [...history.entries.map(cloneEntry), cloneEntry(entry)] };
}

export function selectHistoryEntry(history, entryId) {
  const entry = history.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error('History document was not found.');
  const outcome = loadDocumentJson(JSON.stringify(entry.snapshot));
  const document = cloneDocument(outcome.document);
  return {
    ...outcome,
    document,
    snapshot: cloneDocument(document),
    repairText: JSON.stringify(document, null, 2),
    history: { activeId: entryId, entries: history.entries.map(cloneEntry) }
  };
}

export function loadHistory(storage, fallbackEntry) {
  try {
    const raw = storage?.getItem?.(HISTORY_STORAGE_KEY);
    if (!raw) return { history: createHistoryState(fallbackEntry), notice: '' };
    const parsed = JSON.parse(raw);
    if (!parsed?.activeId || !Array.isArray(parsed.entries) || !parsed.entries.some((entry) => entry?.id === parsed.activeId && Object.prototype.hasOwnProperty.call(entry, 'snapshot'))) throw new Error('Malformed history');
    const entries = parsed.entries.map(cloneEntry);
    return { history: { activeId: parsed.activeId, entries }, notice: '' };
  } catch {
    return { history: createHistoryState(fallbackEntry), notice: 'Saved document history could not be read; a new history was started.' };
  }
}

export function saveHistory(storage, history) {
  try {
    storage?.setItem?.(HISTORY_STORAGE_KEY, JSON.stringify(history));
    return { saved: true, notice: '' };
  } catch {
    return { saved: false, notice: 'Document history could not be saved in this browser.' };
  }
}
