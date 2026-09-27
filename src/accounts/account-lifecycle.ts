import { z } from 'zod';

const accountLifecycleState = z.enum(['active', 'deleting', 'deleted']);

export type AccountLifecycleState = z.infer<typeof accountLifecycleState>;

export interface AccountLifecycleReader {
  read(subject: string): Promise<AccountLifecycleState>;
}

interface AccountLifecycleCollection {
  findOne(
    filter: { readonly _id: string },
    options: {
      readonly maxTimeMS: number;
      readonly projection: { readonly _id: 0; readonly state: 1 };
    },
  ): Promise<unknown>;
}

interface AccountDeletionLedgerCollection {
  findOne(
    filter: { readonly _id: string },
    options: {
      readonly maxTimeMS: number;
      readonly projection: { readonly _id: 1 };
    },
  ): Promise<unknown>;
}

const persistedLifecycle = z.strictObject({ state: accountLifecycleState });
const lifecycleQueryTimeoutMilliseconds = 1_000;

export function createMongoAccountLifecycleReader(
  collections: {
    readonly deletionLedger: AccountDeletionLedgerCollection;
    readonly lifecycle: AccountLifecycleCollection;
  },
): AccountLifecycleReader {
  return {
    async read(subject) {
      const document = await collections.lifecycle.findOne(
        { _id: subject },
        { maxTimeMS: lifecycleQueryTimeoutMilliseconds, projection: { _id: 0, state: 1 } },
      );

      if (document !== null) {
        return persistedLifecycle.parse(document).state;
      }

      // A completed deletion removes ordinary account state. Its time-bounded
      // deletion ledger remains the authority until every old Cognito access
      // token is expired; a genuinely new subject has neither record.
      const deletion = await collections.deletionLedger.findOne(
        { _id: subject },
        { maxTimeMS: lifecycleQueryTimeoutMilliseconds, projection: { _id: 1 } },
      );
      return deletion === null ? 'active' : 'deleted';
    },
  };
}
