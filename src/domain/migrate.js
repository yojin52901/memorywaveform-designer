import { cloneDocument } from './document.js';

export function migrateDocument(source) {
  const document = cloneDocument(source);
  if (document?.schemaVersion !== '1.0') return { document, migrated: false };
  for (const parameter of document.semantic?.timingParameters ?? []) {
    if (!parameter || typeof parameter !== 'object') continue;
    if (!Array.isArray(parameter.startTransitionIds) && 'startTransitionId' in parameter) {
      parameter.startTransitionIds = [parameter.startTransitionId];
    }
    if (!Array.isArray(parameter.endTransitionIds) && 'endTransitionId' in parameter) {
      parameter.endTransitionIds = [parameter.endTransitionId];
    }
    delete parameter.startTransitionId;
    delete parameter.endTransitionId;
  }
  document.schemaVersion = '1.1';
  return { document, migrated: true };
}
