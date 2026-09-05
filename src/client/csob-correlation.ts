import { timingSafeEqual } from "node:crypto"

import {
  CustomerPaymentIntegrationError,
  customerPaymentInvariant,
} from "./errors"
import {
  assertPaymentOperationIdentifiers,
  paymentIdempotencyDigest,
} from "./operation-context"

const CSOB_ORDER_REFERENCE_PATTERN = /^\d{1,10}$/
const CSOB_ORDER_REFERENCE_MODULUS = 10_000_000_000n
const CSOB_MERCHANT_DATA_DIGEST_PATTERN = /^[a-f0-9]{32}$/

export type ParsedCsobMerchantData = {
  version: 1
  correlationId: string
  idempotencyDigest: string
}

export const deriveCsobOrderReference = ({
  idempotencyKey,
  correlationId,
  orderReference,
}: {
  idempotencyKey: string
  correlationId: string
  orderReference?: string
}): string => {
  assertPaymentOperationIdentifiers({ idempotencyKey, correlationId })

  if (orderReference !== undefined) {
    customerPaymentInvariant(
      CSOB_ORDER_REFERENCE_PATTERN.test(orderReference),
      "CSOB_ORDER_REFERENCE_INVALID",
      "ČSOB order reference must contain at most ten digits.",
    )
    return orderReference
  }

  const digest = paymentIdempotencyDigest(idempotencyKey)
  return (BigInt(`0x${digest.slice(0, 16)}`) % CSOB_ORDER_REFERENCE_MODULUS)
    .toString()
    .padStart(10, "0")
}

export const buildCsobMerchantData = ({
  idempotencyKey,
  correlationId,
}: {
  idempotencyKey: string
  correlationId: string
}): string => {
  assertPaymentOperationIdentifiers({ idempotencyKey, correlationId })

  const encoded = Buffer.from(
    JSON.stringify({
      v: 1,
      c: correlationId,
      i: paymentIdempotencyDigest(idempotencyKey).slice(0, 32),
    }),
    "utf8",
  ).toString("base64")

  customerPaymentInvariant(
    encoded.length <= 255,
    "CSOB_MERCHANT_DATA_TOO_LONG",
    "ČSOB merchant data exceeds the provider limit.",
  )

  return encoded
}

export const parseCsobMerchantData = (
  merchantData: string,
): ParsedCsobMerchantData => {
  customerPaymentInvariant(
    typeof merchantData === "string" &&
      merchantData.length > 0 &&
      merchantData.length <= 255 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(merchantData) &&
      merchantData.length % 4 === 0,
    "CSOB_MERCHANT_DATA_INVALID",
    "ČSOB merchant data is invalid.",
  )

  let decoded: unknown
  try {
    const bytes = Buffer.from(merchantData, "base64")
    customerPaymentInvariant(
      bytes.toString("base64") === merchantData,
      "CSOB_MERCHANT_DATA_INVALID",
      "ČSOB merchant data is not canonically encoded.",
    )
    decoded = JSON.parse(bytes.toString("utf8"))
  } catch (error) {
    if (error instanceof CustomerPaymentIntegrationError) {
      throw error
    }
    customerPaymentInvariant(
      false,
      "CSOB_MERCHANT_DATA_INVALID",
      "ČSOB merchant data cannot be decoded.",
    )
  }

  customerPaymentInvariant(
    typeof decoded === "object" &&
      decoded !== null &&
      !Array.isArray(decoded) &&
      Object.keys(decoded).sort().join(",") === "c,i,v",
    "CSOB_MERCHANT_DATA_INVALID",
    "ČSOB merchant data has an unsupported shape.",
  )
  const record = decoded as Record<string, unknown>
  customerPaymentInvariant(
    record.v === 1 &&
      typeof record.c === "string" &&
      typeof record.i === "string" &&
      CSOB_MERCHANT_DATA_DIGEST_PATTERN.test(record.i),
    "CSOB_MERCHANT_DATA_INVALID",
    "ČSOB merchant data has invalid fields.",
  )
  assertPaymentOperationIdentifiers({
    idempotencyKey: "merchant-data-validation",
    correlationId: record.c as string,
  })

  return {
    version: 1,
    correlationId: record.c as string,
    idempotencyDigest: record.i as string,
  }
}

export const verifyCsobMerchantData = ({
  merchantData,
  idempotencyKey,
  correlationId,
}: {
  merchantData: string
  idempotencyKey: string
  correlationId: string
}): void => {
  const expected = Buffer.from(
    buildCsobMerchantData({ idempotencyKey, correlationId }),
    "utf8",
  )
  const candidate = Buffer.from(merchantData, "utf8")

  customerPaymentInvariant(
    candidate.length === expected.length &&
      timingSafeEqual(candidate, expected),
    "CSOB_RETURN_CORRELATION_INVALID",
    "ČSOB return payload correlation is invalid.",
  )
}
