import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateDocument } from '../src/domain/migrate.js';

test('migrates schema 1.0 timing fields without mutating the source', () => {
  const source = {
    schemaVersion: '1.0',
    semantic: { timingParameters: [{ id: 'tp_1', startTransitionId: 'tr_a', endTransitionId: 'tr_b' }] }
  };

  const result = migrateDocument(source);

  assert.equal(result.migrated, true);
  assert.equal(result.document.schemaVersion, '1.1');
  assert.deepEqual(result.document.semantic.timingParameters[0].startTransitionIds, ['tr_a']);
  assert.deepEqual(result.document.semantic.timingParameters[0].endTransitionIds, ['tr_b']);
  assert.equal('startTransitionId' in result.document.semantic.timingParameters[0], false);
  assert.equal(source.semantic.timingParameters[0].startTransitionId, 'tr_a');
});

test('leaves unknown schema versions unchanged for validation to reject', () => {
  const source = { schemaVersion: '2.0', semantic: { timingParameters: [] } };

  assert.deepEqual(migrateDocument(source), { document: source, migrated: false });
});

test('preserves malformed timing entries rather than guessing', () => {
  const source = {
    schemaVersion: '1.0',
    semantic: { timingParameters: [null, 'not-an-entry', { id: 'tp_bad' }] }
  };

  const result = migrateDocument(source);

  assert.deepEqual(result.document.semantic.timingParameters, source.semantic.timingParameters);
  assert.equal(result.migrated, true);
});

test('does not overwrite existing plural endpoint arrays during migration', () => {
  const source = {
    schemaVersion: '1.0',
    semantic: {
      timingParameters: [{
        id: 'tp_1',
        startTransitionId: 'tr_old_start',
        startTransitionIds: ['tr_start_a', 'tr_start_b'],
        endTransitionId: 'tr_old_end',
        endTransitionIds: ['tr_end_a']
      }]
    }
  };

  const result = migrateDocument(source);
  const parameter = result.document.semantic.timingParameters[0];

  assert.deepEqual(parameter.startTransitionIds, ['tr_start_a', 'tr_start_b']);
  assert.deepEqual(parameter.endTransitionIds, ['tr_end_a']);
  assert.equal('startTransitionId' in parameter, false);
  assert.equal('endTransitionId' in parameter, false);
});
