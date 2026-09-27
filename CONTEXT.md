# Checklist library

A personal collection of reusable checklists for working through tasks in order.

## Language

**Checklist definition**:
The reusable title and ordered items of a checklist, independent of any particular
attempt to work through it.
_Avoid_: Checklist state, run

**Checklist item**:
An individually identifiable instruction occupying a position in a checklist
definition.
_Avoid_: Checked item, progress

**Checklist run**:
One attempt to work through a snapshot of a checklist definition, including the
person's current progress.
_Avoid_: Checklist definition, checklist state

**Cloud account**:
The cloud library and control state partition identified by one validated
Cognito `sub`. It is not an email address, Google identity, app-client ID, or
device.
_Avoid_: User email, Google account

**Account lifecycle fence**:
The durable `active`, `deleting`, or `deleted` authorization state checked after
identity verification and before accepting a cloud operation. A retained
deletion-ledger entry continues the `deleted` fence after ordinary account state
is purged.
_Avoid_: Sign-out, token expiry

**PowerSync credential**:
A five-minute JWT minted by the backend for one active cloud account after it
validates a Cognito access token. It authorizes PowerSync download only; API
mutations continue to use the original Cognito access token.
_Avoid_: Cognito token, refresh token
