import { describe, expect, it, vi } from 'vitest';

import { createMongoAccountLifecycleReader } from '../src/accounts/account-lifecycle.js';

describe('MongoDB account lifecycle reader', () => {
  it('treats an unseen subject as a new active account', async () => {
    const lifecycleFindOne = vi.fn().mockResolvedValue(null);
    const ledgerFindOne = vi.fn().mockResolvedValue(null);
    const reader = createMongoAccountLifecycleReader({
      deletionLedger: { findOne: ledgerFindOne },
      lifecycle: { findOne: lifecycleFindOne },
    });

    await expect(reader.read('new-subject')).resolves.toBe('active');
    expect(lifecycleFindOne).toHaveBeenCalledWith(
      { _id: 'new-subject' },
      { maxTimeMS: 2_000, projection: { _id: 0, state: 1 } },
    );
    expect(ledgerFindOne).toHaveBeenCalledWith(
      { _id: 'new-subject' },
      { maxTimeMS: 2_000, projection: { _id: 1 } },
    );
  });

  it.each(['active', 'deleting', 'deleted'] as const)(
    'returns the persisted %s fence',
    async (state) => {
      const reader = createMongoAccountLifecycleReader({
        deletionLedger: { findOne: vi.fn() },
        lifecycle: { findOne: vi.fn().mockResolvedValue({ state }) },
      });

      await expect(reader.read('existing-subject')).resolves.toBe(state);
    },
  );

  it('treats the retained deletion ledger as a deleted lifecycle fence', async () => {
    const reader = createMongoAccountLifecycleReader({
      deletionLedger: { findOne: vi.fn().mockResolvedValue({ _id: 'deleted-subject' }) },
      lifecycle: { findOne: vi.fn().mockResolvedValue(null) },
    });

    await expect(reader.read('deleted-subject')).resolves.toBe('deleted');
  });

  it('fails closed when the persisted lifecycle value is malformed', async () => {
    const reader = createMongoAccountLifecycleReader({
      deletionLedger: { findOne: vi.fn() },
      lifecycle: { findOne: vi.fn().mockResolvedValue({ state: 'enabled' }) },
    });

    await expect(reader.read('existing-subject')).rejects.toThrow();
  });
});
