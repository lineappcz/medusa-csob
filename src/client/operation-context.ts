import { createHash } from "node:crypto"

import { customerPaymentInvariant } from "./errors"
import type { CustomerPaymentOperationContext } from "./types"

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/

const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex")

const lengthPrefixed = (value: string): string => `${value.length}:${value}`

export const assertPaymentOperationIdentifiers = ({
  idempotencyKey,
  correlationId,
}: {
  idempotencyKey: string
  correlationId: string
}): void => {
  customerPaymentInvariant(
    IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey),
    "CUSTOMER_PAYMENT_IDEMPOTENCY_KEY_INVALID",
    "Customer payment idempotency key is invalid.",
  )
  customerPaymentInvariant(
    CORRELATION_ID_PATTERN.test(correlationId),
    "CUSTOMER_PAYMENT_CORRELATION_ID_INVALID",
    "Customer payment correlation ID is invalid.",
  )
}

export const createPaymentOperationFingerprint = ({
  operation,
  idempotencyKey,
  correlationId,
  values,
}: {
  operation: string
  idempotencyKey: string
  correlationId: string
  values: string[]
}): string => {
  assertPaymentOperationIdentifiers({ idempotencyKey, correlationId })

  return hash(
    [operation, idempotencyKey, correlationId, ...values]
      .map(lengthPrefixed)
      .join(""),
  )
}

export const createPaymentOperationContext = ({
  operation,
  idempotencyKey,
  correlationId,
  values,
}: {
  operation: string
  idempotencyKey: string
  correlationId: string
  values: string[]
}): CustomerPaymentOperationContext => ({
  idempotencyKey,
  correlationId,
  requestFingerprint: createPaymentOperationFingerprint({
    operation,
    idempotencyKey,
    correlationId,
    values,
  }),
})

export const paymentIdempotencyDigest = (idempotencyKey: string): string => {
  assertPaymentOperationIdentifiers({
    idempotencyKey,
    correlationId: "validation",
  })

  return hash(idempotencyKey)
}
