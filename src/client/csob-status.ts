import { customerPaymentInvariant } from "./errors"
import { parseMinorUnits } from "./money"
import type {
  CustomerPaymentReconciliation,
  CustomerPaymentState,
} from "./types"

export const CSOB_PAYMENT_STATUSES = {
  1: "payment_initiated",
  2: "payment_in_progress",
  3: "payment_cancelled",
  4: "payment_authorized",
  5: "payment_reversed",
  6: "payment_denied",
  7: "waiting_for_settlement",
  8: "payment_settled",
  9: "refund_processing",
  10: "payment_returned",
} as const

export type CsobPaymentStatusCode = keyof typeof CSOB_PAYMENT_STATUSES

const isCsobPaymentStatusCode = (
  value: number,
): value is CsobPaymentStatusCode => value in CSOB_PAYMENT_STATUSES

const returnedPaymentState = (
  reconciliation?: CustomerPaymentReconciliation,
): CustomerPaymentState => {
  if (!reconciliation) {
    return "refunded"
  }

  const captured = parseMinorUnits(
    reconciliation.capturedAmountMinor,
    "captured amount",
    { allowZero: false },
  )
  const refunded = parseMinorUnits(
    reconciliation.refundedAmountMinor,
    "refunded amount",
    { allowZero: false },
  )
  customerPaymentInvariant(
    refunded <= captured,
    "CUSTOMER_PAYMENT_RECONCILIATION_INVALID",
    "Refunded amount cannot exceed the captured amount.",
  )

  return refunded < captured ? "partially_refunded" : "refunded"
}

export const mapCsobPaymentState = (
  status: number,
  reconciliation?: CustomerPaymentReconciliation,
): CustomerPaymentState => {
  customerPaymentInvariant(
    Number.isInteger(status) && isCsobPaymentStatusCode(status),
    "CSOB_PAYMENT_STATUS_UNKNOWN",
    "ČSOB returned an unknown payment status.",
    "UNKNOWN",
  )

  switch (status) {
    case 1:
    case 2:
      return "pending"
    case 3:
    case 5:
      return "cancelled"
    case 4:
      return "authorized"
    case 6:
      return "failed"
    case 7:
      return "captured"
    case 8:
      return "paid"
    case 9:
      return "refund_pending"
    case 10:
      return returnedPaymentState(reconciliation)
  }
}
