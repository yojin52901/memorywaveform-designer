import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDropTransitionId } from '../src/ui/controller.js';

test('relation drop resolution uses the element under the pointer, not the captured SVG target', () => {
  const target = { closest: (selector) => selector === '[data-transition-id]' ? { dataset: { transitionId: 'tr_target' } } : null };
  const root = { elementFromPoint: () => target };

  assert.equal(resolveDropTransitionId(root, 100, 80), 'tr_target');
});
