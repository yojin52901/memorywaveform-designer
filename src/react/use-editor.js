import { useCallback, useRef, useState } from 'react';
import { saveHistory } from '../ui/document-history.js';
import {
  createInitialEditorState,
  runEditorOperation,
  withExampleDocument,
  withHistoryDeletion,
  withHistorySelection,
  withImportedJson,
  withNewDocument,
  withRepairJson
} from './editor-state.js';

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useEditor() {
  const storageRef = useRef(null);
  if (storageRef.current === null) storageRef.current = browserStorage();

  const stateRef = useRef(null);
  if (stateRef.current === null) stateRef.current = createInitialEditorState(storageRef.current);
  const [state, setState] = useState(stateRef.current);

  const commit = useCallback((next, { persist = false } = {}) => {
    let committed = next;
    if (persist) {
      const outcome = saveHistory(storageRef.current, next.history);
      if (!outcome.saved) committed = { ...next, notice: outcome.notice };
    }
    stateRef.current = committed;
    setState(committed);
    return committed;
  }, []);

  const applyOperation = useCallback((operation) => {
    const previous = stateRef.current;
    const next = runEditorOperation(previous, operation);
    return commit(next, { persist: next.history !== previous.history });
  }, [commit]);

  const setNotice = useCallback((notice = '') => commit({ ...stateRef.current, notice }), [commit]);
  const refresh = useCallback(() => commit({
    ...stateRef.current,
    renderRevision: (stateRef.current.renderRevision ?? 0) + 1
  }), [commit]);
  const setView = useCallback((view) => commit({ ...stateRef.current, view }), [commit]);
  const setRepairSelection = useCallback((repairSelection) => commit({ ...stateRef.current, repairSelection }), [commit]);
  const setSelectedTransition = useCallback((selectedTransitionId) => commit({ ...stateRef.current, selectedTransitionId }), [commit]);

  const importJson = useCallback((text) => {
    const previous = stateRef.current;
    const next = withImportedJson(previous, text);
    return commit(next, { persist: next.history !== previous.history });
  }, [commit]);
  const repairJson = useCallback((text) => {
    const previous = stateRef.current;
    const next = withRepairJson(previous, text);
    return commit(next, { persist: next.history !== previous.history });
  }, [commit]);
  const openExample = useCallback(() => commit(withExampleDocument(stateRef.current), { persist: true }), [commit]);
  const newDocument = useCallback(() => commit(withNewDocument(stateRef.current), { persist: true }), [commit]);
  const selectHistory = useCallback((historyId) => commit(withHistorySelection(stateRef.current, historyId), { persist: true }), [commit]);
  const deleteHistory = useCallback((historyId) => commit(withHistoryDeletion(stateRef.current, historyId), { persist: true }), [commit]);
  const beginRelationCreation = useCallback((kind, values) => commit({
    ...stateRef.current,
    relationCreation: { kind, values, firstTransitionId: null },
    notice: `Select the start transition for the ${kind} relation.`
  }), [commit]);

  return {
    state,
    stateRef,
    applyOperation,
    beginRelationCreation,
    deleteHistory,
    importJson,
    newDocument,
    openExample,
    refresh,
    repairJson,
    selectHistory,
    setNotice,
    setRepairSelection,
    setSelectedTransition,
    setView
  };
}
