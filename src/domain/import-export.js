import { validateDocument } from './validate.js';
import { migrateDocument } from './migrate.js';

function invalidOutcome(document, errors) {
  return {
    document,
    validation: { valid: false, errors, warnings: [] },
    mode: 'repair',
    canRender: false
  };
}

export function loadDocumentJson(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return invalidOutcome(null, [error instanceof Error ? error.message : 'JSON import failed.']);
  }
  try {
    document = migrateDocument(document).document;
    const validation = validateDocument(document);
    return {
      document,
      validation,
      mode: validation.valid ? 'editor' : 'repair',
      canRender: validation.valid
    };
  } catch (error) {
    return invalidOutcome(document, [error instanceof Error ? `Invalid document structure: ${error.message}` : 'Invalid document structure.']);
  }
}

export function exportDocumentJson(document) {
  const validation = validateDocument(document);
  if (!validation.valid) throw new Error('JSON export requires a valid waveform document.');
  return JSON.stringify(document, null, 2);
}

export function getPngExportPolicy(document) {
  try {
    return { allowed: true, draft: !validateDocument(document).valid };
  } catch {
    return { allowed: false, draft: false };
  }
}
