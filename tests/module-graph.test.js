import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every local browser module reachable from main exists', () => {
  const visited = new Set();

  function visit(file) {
    const absolute = path.resolve(file);
    if (visited.has(absolute)) return;

    assert.equal(existsSync(absolute), true, `Missing browser module: ${path.relative(root, absolute)}`);
    visited.add(absolute);

    const source = readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'\"]+?\s+from\s+)?['\"](\.[^'\"]+)['\"]/g)) {
      visit(path.resolve(path.dirname(absolute), match[1]));
    }
  }

  visit(path.join(root, 'src/main.js'));
  assert.equal(visited.has(path.join(root, 'src/domain/migrate.js')), true);
  assert.equal(visited.has(path.join(root, 'src/domain/timing-endpoints.js')), true);
});
