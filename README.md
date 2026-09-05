# ČSOB Gateway for Medusa

[![CI](https://github.com/lineappcz/medusa-csob/actions/workflows/ci.yml/badge.svg)](https://github.com/lineappcz/medusa-csob/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

ČSOB eAPI 1.9 payments: hosted cards (including custom pay-by-link and
`card#LVP`), OneClick, Apple Pay, Google Pay, ČSOB payment button, Skip Pay
(mallpay), NEJsplátka loans, echo checks, RSA-SHA256 signing, 3DS2 purchase
metadata, capture, cancellation, partial refunds and active status checks.

A typed API client and a native Medusa v2 **payment provider**, maintained by LINEAPP.
No storefront, database schema or project-specific business rules are bundled.

## Compatibility and release status

- Node.js 22.12+; CI checks Node 22 and 24.
- Medusa 2.19.0 is the baseline; CI also checks 2.20.1.
- Version 0.2.0 has automated protocol, provider and real-Redis tests. A passing
  test suite is not a bank/carrier certification. [Scope and acceptance](docs/acceptance.md).
- Installable tarballs are distributed in [GitHub Releases](https://github.com/lineappcz/medusa-csob/releases).
  The npm scope is declared in package metadata; npm publication is not claimed.

## Install

```sh
pnpm add https://github.com/lineappcz/medusa-csob/releases/download/v0.1.0/lineapp-medusa-csob-0.1.0.tgz
```

Register `@lineapp/medusa-csob` under the existing Medusa `payment` module's `providers`
array. Do not replace the other providers. See the complete
[configuration and application contract](docs/installation.md).

The API client is available separately:

```ts
import * as client from "@lineapp/medusa-csob/client"
```

Use the client when an application already owns its persistent operation ledger
and workflows. The native provider includes a Redis operation journal. External
writes are reserved before I/O and uncertain operations block retries; a provider's
request identifier alone does not guarantee idempotency.

## What this release does not do

Wallet JavaScript, 3DS iframes and OneClick template enrolment remain host
application work; this package signs and verifies the eAPI calls and returns
`actions` for the storefront to execute. Amount changes require cancelling the
old session and creating a new one. Browser return is not a server webhook;
finish the customer cart through Medusa to trigger an active bank status check.

Credentials, enabled carrier products, shipping prices and fulfillment packing
remain merchant configuration. Unsupported operations fail explicitly.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d --wait
REDIS_TEST_URL=redis://127.0.0.1:16379 pnpm check
pnpm format:check
pnpm pack
docker compose down
```

Tests use synthetic data and generated RSA keys. They do not contact the bank or
carriers. Redis tests use unique namespaces and clean only their own keys.
Coverage is measured across client, provider and operation journal, with enforced
thresholds in `jest.config.cjs`. The CI artifact includes LCOV and a JSON summary.

## Documentation

- [Installation](docs/installation.md) and [runnable configuration examples](examples)
- [Architecture and extension boundaries](docs/architecture.md)
- [Operation recovery, storage and rollout](docs/operations.md)
- [Feature parity and acceptance](docs/acceptance.md)
- [Release process](docs/releases.md), [changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md)
- [AI agent instructions](AGENTS.md) and [documentation index](llms.txt)

Protocol reference: [ČSOB Gateway official documentation](https://github.com/csob/paymentgateway/wiki/Basic-Methods).
Medusa: [module providers](https://docs.medusajs.com/resources/references/payment/provider).
This is an independent community integration; carrier/bank trademarks remain
their owners' property and do not imply endorsement.
