# Installation in a Medusa application

Install the tarball from README.md. Copy examples/provider-options.ts into your
app and change its type import to `@lineapp/medusa-csob`.

Merge into the existing payment module configuration:

```ts
import { options } from "./src/config/csob-options"

// Inside defineConfig({ modules: [...] }):
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [{ resolve: "@lineapp/medusa-csob", id: "csob", options }],
  },
}
```

Keep other providers configured. Run `pnpm medusa db:migrate` and enable
`pp_csob_csob` for the intended region in Medusa Admin. No custom schema migration
is needed; the durable operation journal must already be configured.

## Credentials

Obtain a merchant ID and gateway contract, upload your merchant public key to
ČSOB, and obtain the gateway public key for the selected environment. Configure
exactly one path or base64 source for each key direction. Never publish the merchant
private key. Production key files must be regular files owned by the runtime user,
with mode 0400/0600 and no symlink. Environment is sandbox or production only.

See examples/provider-options.ts and exported CsobProviderOptions for all options.
The merchant return URL is fixed in server configuration and its origin is checked;
a shopper cannot redirect payment completion to another domain.

## Storefront lifecycle

1. Create a payment collection/session with Medusa's standard Store API or SDK,
   selecting `pp_csob_csob`. Medusa supplies the session idempotency key; callers
   must not invoke the provider directly with a random key.
2. Read `payment_session.data.redirect_url` and navigate the browser there.
   Keep the customer's cart ID in the normal secure session/cookie.
3. Implement the configured return URL as a POST-capable storefront endpoint.
   ČSOB sends a browser POST, not a webhook. If SameSite cookies are absent on
   the cross-site POST, respond with a 303 to your own same-origin GET return page
   so the secure cart cookie is available again. Never take the cart identity or
   payment success flag from browser return fields.
4. Complete the authenticated/current cart through Medusa's standard completion
   endpoint. `authorizePayment` actively reads and verifies the signed bank status.
   Pending/failed bank status must leave the cart incomplete. Show a pending page
   and retry the status/completion read with bounded backoff when appropriate.
5. If the customer closes the browser, your host app's recovery job should inspect
   pending sessions and run the core completion workflow under its own order and
   authorization rules. The provider's `getPaymentStatus` is available for this.

The generic provider deliberately returns `not_supported` for webhook actions.
It does not trust posted paymentStatus or invent a bank server notification.
The `/client` export also provides signed browser-return verification for apps
that already own a return-state and order-reconciliation workflow.

## Capture, refund and changed amounts

Automatic capture is default; manual capture is configured explicitly.
Capture/cancel are replay-safe per session. Each refund requires Medusa's stable
refund idempotency key and is serialized against the latest persisted refunded
total. Amounts use exact decimal conversion; unsupported precision is rejected.
Do not mix manual portal refunds with API refunds without reconciling the journal.
Changed amounts require cancelling the previous session and creating a new one;
this version does not silently replace an existing bank payment.

Pass `csob_method` in the payment session context to select a gateway product:
`card` (default), `custom`, `button`, `oneclick`, `applepay`, `googlepay`,
`mallpay` or `loan`. OneClick/wallet methods also need `orig_pay_id` or a
Base64 `payload`, `client_ip` and later a `fingerprint` on `updatePayment`.
Skip Pay and NEJsplátka `cancelPayment` / `refundPayment` call `mallpay/*` or
`loan/*`. Logistics use `updatePayment` with `mallpay_event`+`mallpay_date` or
`loan_event`. Optional `return_method` may be `GET` (default `POST`).
3DS2 `customer` and `order` metadata improve issuer authentication for card
and wallet payments. The `/client` export also exposes GET/POST `echo` and
echo/customer, OneClick and wallet echo helpers.

Use maintenance_mode with an auditable maintenance_reference to stop new checkout
while still allowing necessary reads/refunds. See operations.md before activating.
