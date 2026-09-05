export type CustomerPaymentErrorOutcome =
  | "CONFIGURATION"
  | "DEFINITIVE"
  | "UNKNOWN"

export class CustomerPaymentIntegrationError extends Error {
  readonly code: string
  readonly outcome: CustomerPaymentErrorOutcome
  readonly retryable: boolean
  readonly httpStatus?: number
  readonly providerResultCode?: string

  constructor({
    code,
    message,
    outcome = "DEFINITIVE",
    retryable = false,
    httpStatus,
    providerResultCode,
  }: {
    code: string
    message: string
    outcome?: CustomerPaymentErrorOutcome
    retryable?: boolean
    httpStatus?: number
    providerResultCode?: string
  }) {
    super(message)
    this.name = "CustomerPaymentIntegrationError"
    this.code = code
    this.outcome = outcome
    this.retryable = retryable
    this.httpStatus = httpStatus
    this.providerResultCode = providerResultCode
  }
}

type CustomerPaymentInvariant = (
  condition: unknown,
  code: string,
  message: string,
  outcome?: CustomerPaymentErrorOutcome,
) => asserts condition

export const customerPaymentInvariant: CustomerPaymentInvariant = (
  condition,
  code,
  message,
  outcome = "DEFINITIVE",
): asserts condition => {
  if (!condition) {
    throw new CustomerPaymentIntegrationError({ code, message, outcome })
  }
}

export const asCustomerPaymentIntegrationError = (
  error: unknown,
  operation: "read" | "write",
): CustomerPaymentIntegrationError => {
  if (error instanceof CustomerPaymentIntegrationError) {
    return error
  }

  return new CustomerPaymentIntegrationError({
    code: "CUSTOMER_PAYMENT_OUTCOME_UNKNOWN",
    message: "Customer payment operation outcome could not be confirmed.",
    outcome: "UNKNOWN",
    retryable: operation === "read",
  })
}
