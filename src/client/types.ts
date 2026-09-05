export const CUSTOMER_PAYMENT_STATES = [
  "pending",
  "authorized",
  "captured",
  "paid",
  "cancelled",
  "failed",
  "refund_pending",
  "partially_refunded",
  "refunded",
] as const

export type CustomerPaymentState = (typeof CUSTOMER_PAYMENT_STATES)[number]

export type CustomerPaymentProvider = "csob"

export type MinorUnits = string

export type CustomerPaymentAmount = {
  amountMinor: MinorUnits
  currencyCode: string
}

export type CustomerPaymentLine = {
  name: string
  quantity: number
  amountMinor: MinorUnits
  description?: string
}

export type CustomerPaymentOperationContext = {
  idempotencyKey: string
  correlationId: string
  requestFingerprint: string
}

export type CustomerPaymentReconciliation = {
  capturedAmountMinor: MinorUnits
  refundedAmountMinor: MinorUnits
}

export type CustomerPaymentSnapshot = {
  provider: CustomerPaymentProvider
  providerPaymentId: string
  state: CustomerPaymentState
  providerStatusCode: string
  providerTimestamp: string
  providerResultCode: string
  authorizationCode?: string
  statusDetail?: string
  operationContext?: CustomerPaymentOperationContext
}

export type InitializedCustomerPayment = CustomerPaymentSnapshot & {
  redirectUrl: string
  orderReference: string
  merchantData: string
  operationContext: CustomerPaymentOperationContext
}

export type InitializeCustomerPaymentCommand = {
  amount: CustomerPaymentAmount
  lines: CustomerPaymentLine[]
  returnUrl: string
  captureMode: "automatic" | "manual"
  idempotencyKey: string
  correlationId: string
  orderReference?: string
  customerId?: string
  language?: string
  expiresInSeconds?: number
}

export type GetCustomerPaymentStatusCommand = {
  providerPaymentId: string
  reconciliation?: CustomerPaymentReconciliation
}

export type VerifyCustomerPaymentStatusCommand =
  GetCustomerPaymentStatusCommand & {
    returnPayload: unknown
    idempotencyKey: string
    correlationId: string
  }

export type CaptureCustomerPaymentCommand = {
  providerPaymentId: string
  amountMinor?: MinorUnits
  idempotencyKey: string
  correlationId: string
}

export type CancelCustomerPaymentCommand = {
  providerPaymentId: string
  idempotencyKey: string
  correlationId: string
}

type RefundCustomerPaymentBase = {
  providerPaymentId: string
  idempotencyKey: string
  correlationId: string
}

export type FullRefundCustomerPaymentCommand = RefundCustomerPaymentBase & {
  kind: "full"
}

export type PartialRefundCustomerPaymentCommand = RefundCustomerPaymentBase & {
  kind: "partial"
  amountMinor: MinorUnits
  capturedAmountMinor: MinorUnits
  alreadyRefundedAmountMinor: MinorUnits
}

export type RefundCustomerPaymentCommand =
  | FullRefundCustomerPaymentCommand
  | PartialRefundCustomerPaymentCommand

export interface CustomerPaymentStatusGateway {
  readonly provider: CustomerPaymentProvider

  getPaymentStatus(
    command: GetCustomerPaymentStatusCommand,
  ): Promise<CustomerPaymentSnapshot>

  verifyPaymentStatus(
    command: VerifyCustomerPaymentStatusCommand,
  ): Promise<CustomerPaymentSnapshot>
}

export interface CustomerPaymentGateway extends CustomerPaymentStatusGateway {
  createPaymentRedirectUrl(providerPaymentId: string): Promise<string>

  capturePayment(
    command: CaptureCustomerPaymentCommand,
  ): Promise<CustomerPaymentSnapshot>

  cancelPayment(
    command: CancelCustomerPaymentCommand,
  ): Promise<CustomerPaymentSnapshot>

  refundPayment(
    command: RefundCustomerPaymentCommand,
  ): Promise<CustomerPaymentSnapshot>
}
