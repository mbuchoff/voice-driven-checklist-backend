import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sortedOwners } from './fixture-owners.mjs';

test('compares fixture owners independently of Alice/Bob lexical ordering', () => {
  assert.deepEqual(
    sortedOwners(['00000000-bbbb', 'ffffffff-aaaa']),
    sortedOwners(['ffffffff-aaaa', '00000000-bbbb']),
  );
});
