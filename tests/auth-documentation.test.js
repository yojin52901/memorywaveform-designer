import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('README documents Gmail-only access and browser-local waveform documents', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /@gmail\.com/);
  assert.match(readme, /localStorage/);
  assert.match(readme, /logout|sign out|登出/i);
  assert.doesNotMatch(readme, /Client Secret/);
});
