import { it } from 'vitest';

// Temporary live-policy probe only. This branch must be closed without merging.
it('deliberately fails CI to verify the required test check blocks merging', () => {
  throw new Error('Intentional GH-29 negative protection probe; do not merge.');
});
