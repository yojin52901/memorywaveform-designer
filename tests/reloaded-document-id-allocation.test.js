import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const documentModule = new URL('../src/domain/document.js', import.meta.url).href;
const operationsModule = new URL('../src/domain/operations.js', import.meta.url).href;
const validateModule = new URL('../src/domain/validate.js', import.meta.url).href;

function runReloadedOperation(operation) {
  const script = `
    import { createDocument } from ${JSON.stringify(documentModule)};
    import { addSignal, setSegmentBoundary } from ${JSON.stringify(operationsModule)};
    import { validateDocument } from ${JSON.stringify(validateModule)};

    const persisted = createDocument({ title: 'Reloaded waveform' });
    persisted.semantic.signals.push({
      id: 'sig_0001', name: 'WE#', type: 'control', subtype: '', tags: [], initialState: 'HIGH'
    });
    persisted.presentation.signalRowOrder.push('sig_0001');
    persisted.semantic.stateSegments.push({
      id: 'seg_0002', signalId: 'sig_0001', startMarkerId: 'tm_start', endMarkerId: 'tm_end', state: 'HIGH'
    });

    const updated = ${operation === 'addSignal'
      ? "addSignal(persisted, { name: 'CE#', type: 'control', initialState: 'HIGH' })"
      : "setSegmentBoundary(persisted, { signalId: 'sig_0001', sequence: 10, rightState: 'LOW' })"};
    process.stdout.write(JSON.stringify({
      validation: validateDocument(updated),
      ids: [
        ...updated.semantic.signals,
        ...updated.semantic.timeline.timeMarkers,
        ...updated.semantic.stateSegments,
        ...updated.semantic.transitions,
        ...updated.semantic.timingParameters,
        ...updated.semantic.phases,
        ...updated.semantic.annotations
      ].map((item) => item.id)
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('a reloaded persisted document can add objects without duplicating IDs or breaking transition adjacency', () => {
  for (const operation of ['addSignal', 'addBoundary']) {
    const result = runReloadedOperation(operation);

    assert.deepEqual(result.validation, { valid: true, errors: [], warnings: [] });
    assert.equal(new Set(result.ids).size, result.ids.length);
  }
});
