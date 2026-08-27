import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRequirement } from '../src/domain/requirement.js';

test('parses comparison and range timing rules', () => {
  assert.deepEqual(parseRequirement('>= 20 ns'), {
    kind: 'comparison', operator: '>=', value: 20, unit: 'ns'
  });
  assert.deepEqual(parseRequirement('20 ns..40 ns'), {
    kind: 'range', min: 20, max: 40, unit: 'ns'
  });
  assert.equal(parseRequirement('about twenty nanoseconds'), null);
});
