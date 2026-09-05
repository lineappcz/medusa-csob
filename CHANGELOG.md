# Changelog

## 0.2.0 — 2026-09-05

- Cover remaining ČSOB eAPI 1.9 methods in the public client: echo,
  echo/customer, OneClick, Apple Pay, Google Pay, payment button, Skip Pay
  (mallpay) and NEJsplátka (loan), including logistics/refund variants.
- Accept 3DS2 customer/order purchase metadata, `card#LVP`, custom payments
  with `customerCode` pay-by-link URLs, and signed `actions` for device
  fingerprint / challenge.
- Native provider selects the checkout method from session context and can
  process in-shop OneClick/wallet payments when the storefront supplies a
  fingerprint. Skip Pay and NEJsplátka cancel, refund and logistics use the
  dedicated eAPI endpoints. GET `echo` and `returnMethod` GET are supported.

## 0.1.0 — 2026-09-05

- Initial ČSOB Gateway Medusa provider and typed client.
- Persistent operation reservations and conservative uncertain-write recovery.
- Protocol fixtures, native provider tests, real Redis concurrency/restart tests.
- CI compatibility matrix, coverage reports, packed release artifacts and docs.

Scope and live acceptance exclusions are in docs/acceptance.md.
