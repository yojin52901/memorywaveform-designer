import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadDocumentJson } from '../src/domain/import-export.js';

test('the JSON transfer contract contains a valid canonical schema 1.1 document', async () => {
  const spec = await readFile(new URL('../docs/spec.md', import.meta.url), 'utf8');
  const contract = spec.match(/### JSON 傳遞契約[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert.ok(contract, 'expected a JSON fenced block under JSON 傳遞契約');

  const outcome = loadDocumentJson(contract[1]);

  assert.equal(outcome.mode, 'editor', outcome.validation.errors.join('\n'));
  assert.equal(outcome.validation.valid, true);
  assert.ok(outcome.document.semantic.timingParameters.length > 0);
  for (const parameter of outcome.document.semantic.timingParameters) {
    assert.ok(Array.isArray(parameter.startTransitionIds));
    assert.ok(Array.isArray(parameter.endTransitionIds));
    assert.equal('startTransitionId' in parameter, false);
    assert.equal('endTransitionId' in parameter, false);
  }
});
