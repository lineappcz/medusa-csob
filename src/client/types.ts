import type {
  CsobAuthFingerprint,
  CsobPaymentActions,
  CsobRedirect,
} from "./csob-auth-data"
import type {
  CsobLoanCustomer,
  CsobMallpayCustomer,
  CsobMallpayItem,
  CsobMallpayOrder,
  CsobMallpayOrderRef,
} from "./csob-alt-payments"
import type { CsobPayMethod, CsobPayOperation } from "./csob-constants"
import type {
  CsobPurchaseCustomer,
  CsobPurchaseOrder,
} from "./csob-purchase-data"

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
  resultMessage?: string
  initParams?: Record<string, unknown>
  actions?: CsobPaymentActions
  customerCode?: string
  payByLinkUrl?: string
  redirect?: CsobRedirect
  mallpayUrl?: string
  comparisonUrl?: string
  extensions?: Array<Record<string, unknown>>
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
  payOperation?: CsobPayOperation
  payMethod?: CsobPayMethod
  customer?: CsobPurchaseCustomer
  order?: CsobPurchaseOrder
  logoVersion?: number
  colorSchemeVersion?: number
  customExpiry?: string
  returnMethod?: "POST" | "GET"
}

export type CsobEchoResult = {
  provider: "csob"
  providerTimestamp: string
  providerResultCode: string
  resultMessage: string
  origPayId?: string
  customerId?: string
  initParams?: Record<string, unknown>
  extensions?: Array<Record<string, unknown>>
}

export type InitializeOneClickPaymentCommand = {
  origPayId: string
  idempotencyKey: string
  correlationId: string
  orderReference?: string
  amount?: CustomerPaymentAmount
  clientIp?: string
  returnUrl?: string
  captureMode?: "automatic" | "manual"
  payMethod?: CsobPayMethod
  customer?: CsobPurchaseCustomer
  order?: CsobPurchaseOrder
  clientInitiated?: boolean
  sdkUsed?: boolean
  language?: string
  expiresInSeconds?: number
  returnMethod?: "POST" | "GET"
}

export type InitializeWalletPaymentCommand = {
  payload: string
  clientIp: string
  amount: CustomerPaymentAmount
  returnUrl: string
  captureMode: "automatic" | "manual"
  idempotencyKey: string
  correlationId: string
  orderReference?: string
  customer?: CsobPurchaseCustomer
  order?: CsobPurchaseOrder
  sdkUsed?: boolean
  language?: string
  expiresInSeconds?: number
  returnMethod?: "POST" | "GET"
}

export type ProcessAuthenticatedPaymentCommand = {
  providerPaymentId: string
  fingerprint?: CsobAuthFingerprint
  idempotencyKey: string
  correlationId: string
}

export type InitializeButtonPaymentCommand = {
  amount: CustomerPaymentAmount
  clientIp: string
  returnUrl: string
  idempotencyKey: string
  correlationId: string
  orderReference?: string
  language?: string
  brand?: "csob"
  returnMethod?: "POST" | "GET"
}

export type InitializeMallpayPaymentCommand = {
  customer: CsobMallpayCustomer
  order: CsobMallpayOrder
  agreeTC: boolean
  clientIp: string
  returnUrl: string
  idempotencyKey: string
  correlationId: string
  orderReference?: string
  expiresInSeconds?: number
  returnMethod?: "POST" | "GET"
}

export type MallpayLogisticsCommand = {
  providerPaymentId: string
  date: string
  event?: string
  fulfilled?: CsobMallpayOrderRef
  cancelled?: CsobMallpayOrderRef
  deliveryTrackingNumber?: string
  idempotencyKey: string
  correlationId: string
}

export type MallpayCancelCommand = CancelCustomerPaymentCommand & {
  reason: string
}

export type MallpayRefundCommand = {
  providerPaymentId: string
  amountMinor?: MinorUnits
  refundedItems?: Array<
    Pick<CsobMallpayItem, "code" | "ean" | "name" | "type" | "quantity">
  >
  idempotencyKey: string
  correlationId: string
}

export type InitializeLoanPaymentCommand = {
  purchaseId: string
  clientIp: string
  amount: CustomerPaymentAmount
  returnUrl: string
  idempotencyKey: string
  correlationId: string
  orderReference?: string
  customer?: CsobLoanCustomer
  language?: string
  returnMethod?: "POST" | "GET"
}

export type LoanLogisticsCommand = {
  providerPaymentId: string
  event: string
  idempotencyKey: string
  correlationId: string
}

export type LoanRefundCommand = {
  providerPaymentId: string
  amountMinor?: MinorUnits
  reason?: string
  date?: string
  idempotencyKey: string
  correlationId: string
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
