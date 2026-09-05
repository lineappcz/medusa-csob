import type { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber, MedusaError } from "@medusajs/framework/utils"

import { CSOB_CURRENCIES, parseMinorUnits } from "../client"

const assertSupportedCurrency = (currencyCode: string): string => {
  const currency = currencyCode.toUpperCase()
  if (!(CSOB_CURRENCIES as readonly string[]).includes(currency)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `ČSOB does not support currency ${currency}.`,
    )
  }
  return currency
}

/**
 * All currencies enabled by the ČSOB eAPI adapter use two ISO minor digits.
 * Conversion stays inside bignumber.js and rejects values that would require
 * rounding rather than silently changing the amount charged to the customer.
 */
export const medusaAmountToCsobMinorUnits = (
  amount: BigNumberInput,
  currencyCode: string,
  { allowZero = false }: { allowZero?: boolean } = {},
): string => {
  assertSupportedCurrency(currencyCode)
  const decimal = new BigNumber(amount).bigNumber
  if (!decimal || !decimal.isFinite() || decimal.isNegative()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Payment amount is not a finite non-negative decimal.",
    )
  }
  const minor = decimal.multipliedBy(100)
  if (!minor.isInteger()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Payment amount has more precision than the currency supports.",
    )
  }
  const value = minor.toFixed(0)
  parseMinorUnits(value, "payment amount", { allowZero })
  return value
}

export const csobMinorUnitsToMedusaAmount = (
  amountMinor: string,
  currencyCode: string,
): string => {
  assertSupportedCurrency(currencyCode)
  parseMinorUnits(amountMinor, "payment amount")
  return new BigNumber(amountMinor).bigNumber!.dividedBy(100).toFixed(2)
}
