# Scope, parity and acceptance

## Automated release gate

Every release runs type checking (including configuration examples), Medusa's
recommended lint rules, Jest with coverage thresholds, a TypeScript declaration
build, formatting and packed-provider/client import smoke tests. CI exercises
Node 22/24 and Medusa 2.19.0/2.20.1. See the exact release commit's Actions run and
coverage artifact for evidence. No percentage is a claim of semantic completeness.

## Extraction and ownership

The protocol client was extracted from a working application integration. The
application's custom order, legal, production and database-ledger logic is outside
the package. Existing consumers can adopt the `/client` exports without replacing
their durable workflows. New Medusa apps can register the native provider.

| Capability                            | Public client | Native provider              | Host application                          |
| ------------------------------------- | ------------- | ---------------------------- | ----------------------------------------- |
| Protocol request/response validation  | Yes           | Uses client                  | Supplies authoritative input              |
| Credentials and environment selection | Yes           | Startup configuration        | Supplies own account secrets              |
| Status reads and conservative mapping | Yes           | Lifecycle integration        | Schedules recovery/polling                |
| External write reservation            | Caller-owned  | Persistent operation journal | Provides durable Redis or OperationStore  |
| Business-specific order rules         | No            | No                           | Retains its own workflows                 |
| Unknown write outcome recovery        | Typed failure | Blocks retries               | Operator reconciles authoritative records |

## CSOB Gateway

- Retained: eAPI 1.9 canonical RSA signing and response verification, exact money
  conversion, payment init/process/status/close/reverse/refund, correlation checks,
  strict endpoint/return URL configuration and no automatic write retries.
- Added: native Medusa payment lifecycle and durable session/capture/cancel/refund
  journal with refund totals serialized per session.
- Caller-owned: checkout return endpoint, cart completion, abandoned-session
  reconciliation, merchant keys/certification and application-specific legal rules.
- Browser return payloads never authorize payment. The provider reads a signed
  bank status during authorization. The browser return is not a webhook.
- Changed amount/currency requires cancelling and recreating the session.
- Apple Pay/Google Pay direct integration, recurring payments and one-click flows
  are outside 0.1. Hosted card checkout is supported.

Merchant acceptance: use sandbox merchant keys to complete success/decline/cancel,
manual capture, partial/full refund and interrupted return scenarios in a real
Medusa checkout. Validate the bank portal ledger and order state. Sandbox merchant
certification and production activation are not supplied by this repository.

## Evidence limits

Automated tests use synthetic provider responses, real cryptographic signatures
where applicable and a real local/CI Redis with isolated test namespaces. They do
not contact carrier/bank accounts and are not live-provider certification. Host
application adoption and live merchant acceptance are separate release evidence.
