import { parseCsobPaymentActions, parseCsobRedirect } from "./csob-auth-data"
import {
  CustomerPaymentIntegrationError,
  customerPaymentInvariant,
} from "./errors"
import { isCsobDateTime } from "./csob-date"
import { isCanonicalBase64, type CsobPaymentResponseWire } from "./csob-signing"
import type { CustomerPaymentHttpResponse } from "./http-client"

export type CsobApiResponseKind =
  | "init"
  | "payment"
  | "process"
  | "echo"
  | "echoCustomer"
  | "oneclickEcho"
  | "applepayEcho"
  | "googlepayEcho"
  | "button"
  | "mallpayInit"
  | "loanInit"

const PAY_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}@[A-Za-z0-9_-]{2,8}$/
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const API_RESPONSE_KEYS = new Set([
  "payId",
  "dttm",
  "resultCode",
  "resultMessage",
  "paymentStatus",
  "authCode",
  "customerCode",
  "statusDetail",
  "actions",
  "extensions",
  "signature",
  "redirect",
  "mallpayUrl",
  "comparisonUrl",
  "origPayId",
  "customerId",
  "initParams",
])
const RETURN_RESPONSE_KEYS = new Set([
  "payId",
  "dttm",
  "resultCode",
  "resultMessage",
  "paymentStatus",
  "authCode",
  "merchantData",
  "statusDetail",
  "signature",
])

const asRecord = (value: unknown): Record<string, unknown> => {
  customerPaymentInvariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "CSOB_RESPONSE_INVALID",
    "ČSOB returned an invalid response.",
    "UNKNOWN",
  )

  return value as Record<string, unknown>
}

const requiredString = (
  record: Record<string, unknown>,
  key: string,
): string => {
  const value = record[key]
  customerPaymentInvariant(
    typeof value === "string" && value.length > 0,
    "CSOB_RESPONSE_INVALID",
    "ČSOB response is missing a required string.",
    "UNKNOWN",
  )
  return value
}

const optionalString = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = record[key]
  customerPaymentInvariant(
    value === undefined || (typeof value === "string" && value.length > 0),
    "CSOB_RESPONSE_INVALID",
    "ČSOB response contains an invalid optional string.",
    "UNKNOWN",
  )
  return value as string | undefined
}

const requiredInteger = (
  record: Record<string, unknown>,
  key: string,
): number => {
  const value = record[key]
  customerPaymentInvariant(
    typeof value === "number" && Number.isSafeInteger(value),
    "CSOB_RESPONSE_INVALID",
    "ČSOB response is missing a required integer.",
    "UNKNOWN",
  )
  return value
}

const parseFormInteger = (
  record: Record<string, unknown>,
  key: string,
): number => {
  const value = record[key]
  customerPaymentInvariant(
    (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) ||
      (typeof value === "number" && Number.isSafeInteger(value) && value >= 0),
    "CSOB_RETURN_PAYLOAD_INVALID",
    "ČSOB return payload contains an invalid integer.",
  )

  const parsed = typeof value === "number" ? value : Number(value)
  customerPaymentInvariant(
    Number.isSafeInteger(parsed),
    "CSOB_RETURN_PAYLOAD_INVALID",
    "ČSOB return payload integer exceeds the supported range.",
  )
  return parsed
}

const assertAllowedKeys = (
  record: Record<string, unknown>,
  allowedKeys: Set<string>,
  code: string,
): void => {
  customerPaymentInvariant(
    Object.keys(record).every((key) => allowedKeys.has(key)),
    code,
    "ČSOB response contains unsupported fields.",
    "UNKNOWN",
  )
}

const getHeader = (
  headers: Record<string, string>,
  expectedName: string,
): string => {
  const match = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === expectedName.toLowerCase(),
  )
  return match?.[1] ?? ""
}

const normalizeReturnRecord = (payload: unknown): Record<string, unknown> => {
  if (payload instanceof URLSearchParams) {
    const record: Record<string, string> = {}
    for (const [key, value] of payload.entries()) {
      customerPaymentInvariant(
        record[key] === undefined,
        "CSOB_RETURN_PAYLOAD_INVALID",
        "ČSOB return payload contains duplicate fields.",
      )
      record[key] = value
    }
    return record
  }

  return asRecord(payload)
}

const validateCommonResponse = (
  record: Record<string, unknown>,
  integerParser: (record: Record<string, unknown>, key: string) => number,
  invalidCode: string,
  requirePayment = true,
): CsobPaymentResponseWire => {
  const response: CsobPaymentResponseWire = {
    payId: requirePayment
      ? requiredString(record, "payId")
      : (optionalString(record, "payId") ?? ""),
    dttm: requiredString(record, "dttm"),
    resultCode: integerParser(record, "resultCode"),
    resultMessage: requiredString(record, "resultMessage"),
    paymentStatus: requirePayment
      ? integerParser(record, "paymentStatus")
      : record.paymentStatus === undefined
        ? 0
        : integerParser(record, "paymentStatus"),
    authCode: optionalString(record, "authCode"),
    customerCode: optionalString(record, "customerCode"),
    merchantData: optionalString(record, "merchantData"),
    statusDetail: optionalString(record, "statusDetail"),
    origPayId: optionalString(record, "origPayId"),
    customerId: optionalString(record, "customerId"),
    mallpayUrl: optionalString(record, "mallpayUrl"),
    comparisonUrl: optionalString(record, "comparisonUrl"),
    actions: parseCsobPaymentActions(record.actions),
    redirect: parseCsobRedirect(record.redirect),
    initParams:
      record.initParams === undefined
        ? undefined
        : (asRecord(record.initParams) as Record<string, unknown>),
    extensions: Array.isArray(record.extensions)
      ? (record.extensions as Array<Record<string, unknown>>)
      : undefined,
    signature: requiredString(record, "signature"),
  }

  customerPaymentInvariant(
    (!requirePayment || PAY_ID_PATTERN.test(response.payId)) &&
      isCsobDateTime(response.dttm) &&
      isCanonicalBase64(response.signature),
    invalidCode,
    "ČSOB response contains invalid identifiers or signature encoding.",
    "UNKNOWN",
  )

  return response
}

export const parseCsobApiResponse = ({
  response,
  operation,
  kind = "payment",
}: {
  response: CustomerPaymentHttpResponse
  operation: "read" | "write"
  kind?: CsobApiResponseKind
}): CsobPaymentResponseWire => {
  if (response.status !== 200) {
    const retryableStatus = RETRYABLE_HTTP_STATUSES.has(response.status)
    throw new CustomerPaymentIntegrationError({
      code: retryableStatus
        ? "CSOB_TEMPORARILY_UNAVAILABLE"
        : "CSOB_REQUEST_REJECTED",
      message: retryableStatus
        ? "ČSOB payment API is temporarily unavailable."
        : "ČSOB rejected the payment API request.",
      outcome: retryableStatus ? "UNKNOWN" : "DEFINITIVE",
      retryable: retryableStatus && operation === "read",
      httpStatus: response.status,
    })
  }

  const contentType = getHeader(response.headers, "content-type")
  customerPaymentInvariant(
    contentType.toLowerCase().includes("application/json"),
    "CSOB_RESPONSE_CONTENT_TYPE_INVALID",
    "ČSOB returned an unexpected content type.",
    "UNKNOWN",
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new CustomerPaymentIntegrationError({
      code: "CSOB_RESPONSE_INVALID",
      message: "ČSOB returned invalid JSON.",
      outcome: "UNKNOWN",
    })
  }

  const record = asRecord(parsed)
  assertAllowedKeys(record, API_RESPONSE_KEYS, "CSOB_RESPONSE_INVALID")
  const requirePayment = ![
    "echo",
    "echoCustomer",
    "oneclickEcho",
    "applepayEcho",
    "googlepayEcho",
  ].includes(kind)

  return validateCommonResponse(
    record,
    requiredInteger,
    "CSOB_RESPONSE_INVALID",
    requirePayment,
  )
}

export const parseCsobReturnPayload = (
  payload: unknown,
): CsobPaymentResponseWire => {
  const record = normalizeReturnRecord(payload)
  assertAllowedKeys(record, RETURN_RESPONSE_KEYS, "CSOB_RETURN_PAYLOAD_INVALID")

  return validateCommonResponse(
    record,
    parseFormInteger,
    "CSOB_RETURN_PAYLOAD_INVALID",
  )
}

export const assertCsobPayId = (payId: string): void => {
  customerPaymentInvariant(
    PAY_ID_PATTERN.test(payId),
    "CSOB_PAY_ID_INVALID",
    "ČSOB payment ID is invalid.",
  )
}
