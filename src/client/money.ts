import { customerPaymentInvariant } from "./errors"
import type { MinorUnits } from "./types"

const MINOR_UNITS_PATTERN = /^(0|[1-9]\d*)$/

export const parseMinorUnits = (
  value: MinorUnits,
  field: string,
  { allowZero = true }: { allowZero?: boolean } = {},
): bigint => {
  customerPaymentInvariant(
    typeof value === "string" && MINOR_UNITS_PATTERN.test(value),
    "CUSTOMER_PAYMENT_AMOUNT_INVALID",
    `${field} must be a canonical non-negative integer string.`,
  )

  const amount = BigInt(value)
  customerPaymentInvariant(
    allowZero || amount > 0n,
    "CUSTOMER_PAYMENT_AMOUNT_INVALID",
    `${field} must be greater than zero.`,
  )

  return amount
}

export const minorUnitsToSafeNumber = (
  value: MinorUnits,
  field: string,
  options?: { allowZero?: boolean },
): number => {
  const amount = parseMinorUnits(value, field, options)
  customerPaymentInvariant(
    amount <= BigInt(Number.MAX_SAFE_INTEGER),
    "CUSTOMER_PAYMENT_AMOUNT_UNSAFE",
    `${field} exceeds the exact JSON integer range.`,
  )

  return Number(amount)
}

export const sumMinorUnits = (
  values: MinorUnits[],
  field: string,
): MinorUnits =>
  values
    .reduce((total, value) => total + parseMinorUnits(value, field), 0n)
    .toString()
