import {
  CSOB_CURRENCIES,
  CSOB_CUSTOM_PAYMENT_URLS,
  CSOB_EAPI_1_9_ENDPOINTS,
  CSOB_LANGUAGES,
  CSOB_PAY_METHODS,
  CSOB_PAY_OPERATIONS,
  CSOB_RETURN_METHODS,
  type CsobEnvironment,
  type CsobReturnMethod,
} from "./csob-constants"
import { assertCsobAuthFingerprint, assertCsobClientIp } from "./csob-auth-data"
import {
  assertCsobCalendarDate,
  assertCsobLanguage,
  assertCsobLoanCustomer,
  assertCsobMallpayCustomer,
  assertCsobMallpayOrder,
} from "./csob-alt-payments"
import {
  assertCsobPurchaseCustomer,
  assertCsobPurchaseOrder,
} from "./csob-purchase-data"
import {
  buildCsobMerchantData,
  deriveCsobOrderReference,
  verifyCsobMerchantData,
} from "./csob-correlation"
import { formatCsobDateTime } from "./csob-date"
import {
  assertCsobPayId,
  parseCsobApiResponse,
  parseCsobReturnPayload,
  type CsobApiResponseKind,
} from "./csob-response"
import {
  buildCsobButtonInitSignatureText,
  buildCsobEchoSignatureText,
  buildCsobLoanInitSignatureText,
  buildCsobLoanRefundSignatureText,
  buildCsobMallpayInitSignatureText,
  buildCsobMallpayLogisticsSignatureText,
  buildCsobMallpayRefundSignatureText,
  buildCsobOneClickInitSignatureText,
  buildCsobPaymentInitSignatureText,
  buildCsobPaymentOperationSignatureText,
  buildCsobPaymentResponseSignatureText,
  buildCsobProcessSignatureText,
  buildCsobReasonedOperationSignatureText,
  buildCsobReturnSignatureText,
  buildCsobWalletInitSignatureText,
  isCanonicalBase64,
  type CsobPaymentInitWire,
  type CsobPaymentResponseWire,
  type CsobRequestSigner,
  type CsobResponseVerifier,
} from "./csob-signing"
import { mapCsobPaymentState } from "./csob-status"
import {
  CustomerPaymentIntegrationError,
  asCustomerPaymentIntegrationError,
  customerPaymentInvariant,
} from "./errors"
import {
  FetchCustomerPaymentHttpClient,
  type CustomerPaymentHttpClient,
  type CustomerPaymentHttpResponse,
} from "./http-client"
import { minorUnitsToSafeNumber, parseMinorUnits, sumMinorUnits } from "./money"
import { createPaymentOperationContext } from "./operation-context"
import type {
  CancelCustomerPaymentCommand,
  CaptureCustomerPaymentCommand,
  CsobEchoResult,
  CustomerPaymentGateway,
  CustomerPaymentStatusGateway,
  CustomerPaymentOperationContext,
  CustomerPaymentReconciliation,
  CustomerPaymentSnapshot,
  GetCustomerPaymentStatusCommand,
  InitializedCustomerPayment,
  InitializeButtonPaymentCommand,
  InitializeCustomerPaymentCommand,
  InitializeLoanPaymentCommand,
  InitializeMallpayPaymentCommand,
  InitializeOneClickPaymentCommand,
  InitializeWalletPaymentCommand,
  LoanLogisticsCommand,
  LoanRefundCommand,
  MallpayCancelCommand,
  MallpayLogisticsCommand,
  MallpayRefundCommand,
  ProcessAuthenticatedPaymentCommand,
  RefundCustomerPaymentCommand,
  VerifyCustomerPaymentStatusCommand,
} from "./types"

const MERCHANT_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/
const CUSTOMER_ID_PATTERN = /^\S(?:.{0,48}\S)?$/u
const SAFE_TEXT_PATTERN = /^\S(?:.*\S)?$/u

export type CsobEapi19AdapterConfig = {
  environment: CsobEnvironment
  merchantId: string
  signer: CsobRequestSigner
  verifier: CsobResponseVerifier
  allowInsecureLocalReturnUrl?: boolean
  httpClient?: CustomerPaymentHttpClient
  timeoutMs?: number
  clock?: () => Date
}

type SendPaymentRequestInput = {
  path: string
  method: "GET" | "POST" | "PUT"
  body?: string
  operation: "read" | "write"
  responseType: CsobApiResponseKind
  expectedPayId?: string
  reconciliation?: CustomerPaymentReconciliation
  acceptNonZeroResult?: boolean
}

const assertText = ({
  value,
  maximumLength,
  code,
  message,
}: {
  value: string
  maximumLength: number
  code: string
  message: string
}): void => {
  customerPaymentInvariant(
    typeof value === "string" &&
      value.length <= maximumLength &&
      SAFE_TEXT_PATTERN.test(value),
    code,
    message,
  )
}

const assertReturnUrl = (
  value: string,
  allowInsecureLocalReturnUrl: boolean,
): void => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CustomerPaymentIntegrationError({
      code: "CSOB_RETURN_URL_INVALID",
      message: "ČSOB return URL is invalid.",
    })
  }

  const localHttpAllowed =
    allowInsecureLocalReturnUrl &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  customerPaymentInvariant(
    (url.protocol === "https:" || localHttpAllowed) &&
      !url.username &&
      !url.password &&
      !url.hash,
    "CSOB_RETURN_URL_INVALID",
    "ČSOB return URL must be HTTPS and cannot contain credentials or a fragment.",
  )
  customerPaymentInvariant(
    value.length <= 300,
    "CSOB_RETURN_URL_INVALID",
    "ČSOB return URL exceeds the provider limit.",
  )
}

const resolveReturnMethod = (value?: string): CsobReturnMethod => {
  const method = value ?? "POST"
  customerPaymentInvariant(
    CSOB_RETURN_METHODS.includes(method as CsobReturnMethod),
    "CSOB_RETURN_METHOD_UNSUPPORTED",
    "ČSOB return method must be POST or GET.",
  )
  return method as CsobReturnMethod
}

const assertInitializationCommand = (
  command: InitializeCustomerPaymentCommand,
  allowInsecureLocalReturnUrl: boolean,
): void => {
  parseMinorUnits(command.amount.amountMinor, "payment amount", {
    allowZero: false,
  })
  customerPaymentInvariant(
    CSOB_CURRENCIES.includes(
      command.amount.currencyCode as (typeof CSOB_CURRENCIES)[number],
    ),
    "CSOB_CURRENCY_UNSUPPORTED",
    "ČSOB payment currency is unsupported.",
  )
  customerPaymentInvariant(
    command.lines.length >= 1 && command.lines.length <= 2,
    "CSOB_CART_INVALID",
    "ČSOB payment cart must contain one or two lines.",
  )

  for (const line of command.lines) {
    assertText({
      value: line.name,
      maximumLength: 20,
      code: "CSOB_CART_INVALID",
      message: "ČSOB cart line name is invalid.",
    })
    customerPaymentInvariant(
      Number.isSafeInteger(line.quantity) && line.quantity >= 1,
      "CSOB_CART_INVALID",
      "ČSOB cart line quantity is invalid.",
    )
    parseMinorUnits(line.amountMinor, "cart line amount")
    if (line.description !== undefined) {
      assertText({
        value: line.description,
        maximumLength: 40,
        code: "CSOB_CART_INVALID",
        message: "ČSOB cart line description is invalid.",
      })
    }
  }

  customerPaymentInvariant(
    sumMinorUnits(
      command.lines.map((line) => line.amountMinor),
      "cart line amount",
    ) === command.amount.amountMinor,
    "CSOB_CART_TOTAL_MISMATCH",
    "ČSOB cart line amounts do not match the payment total.",
  )
  assertReturnUrl(command.returnUrl, allowInsecureLocalReturnUrl)

  if (command.customerId !== undefined) {
    customerPaymentInvariant(
      CUSTOMER_ID_PATTERN.test(command.customerId) &&
        command.customerId.length <= 50,
      "CSOB_CUSTOMER_ID_INVALID",
      "ČSOB customer ID is invalid.",
    )
  }

  const language = command.language ?? "cs"
  customerPaymentInvariant(
    CSOB_LANGUAGES.includes(language as (typeof CSOB_LANGUAGES)[number]),
    "CSOB_LANGUAGE_UNSUPPORTED",
    "ČSOB payment language is unsupported.",
  )

  if (command.expiresInSeconds !== undefined) {
    customerPaymentInvariant(
      Number.isInteger(command.expiresInSeconds) &&
        command.expiresInSeconds >= 300 &&
        command.expiresInSeconds <= 1_800,
      "CSOB_PAYMENT_TTL_INVALID",
      "ČSOB payment lifetime must be between 300 and 1800 seconds.",
    )
  }

  if (command.payOperation !== undefined) {
    customerPaymentInvariant(
      CSOB_PAY_OPERATIONS.includes(command.payOperation),
      "CSOB_PAY_OPERATION_UNSUPPORTED",
      "ČSOB payment operation is unsupported.",
    )
  }
  if (command.payMethod !== undefined) {
    customerPaymentInvariant(
      CSOB_PAY_METHODS.includes(command.payMethod),
      "CSOB_PAY_METHOD_UNSUPPORTED",
      "ČSOB payment method is unsupported.",
    )
  }
  assertCsobPurchaseCustomer(command.customer)
  assertCsobPurchaseOrder(command.order)
  if (command.logoVersion !== undefined) {
    customerPaymentInvariant(
      Number.isInteger(command.logoVersion) && command.logoVersion >= 1,
      "CSOB_LOGO_VERSION_INVALID",
      "ČSOB logo version is invalid.",
    )
  }
  if (command.colorSchemeVersion !== undefined) {
    customerPaymentInvariant(
      Number.isInteger(command.colorSchemeVersion) &&
        command.colorSchemeVersion >= 1,
      "CSOB_COLOR_SCHEME_INVALID",
      "ČSOB colour scheme version is invalid.",
    )
  }
  if (command.customExpiry !== undefined) {
    customerPaymentInvariant(
      /^\d{14}$/.test(command.customExpiry),
      "CSOB_CUSTOM_EXPIRY_INVALID",
      "ČSOB custom payment expiry must use YYYYMMDDHHMMSS.",
    )
    customerPaymentInvariant(
      command.payOperation === "customPayment",
      "CSOB_CUSTOM_EXPIRY_INVALID",
      "ČSOB custom expiry is valid only for customPayment.",
    )
  }
}

const operationContextValuesForInitialization = ({
  command,
  orderReference,
}: {
  command: InitializeCustomerPaymentCommand
  orderReference: string
}): string[] => [
  orderReference,
  command.amount.amountMinor,
  command.amount.currencyCode,
  command.returnUrl,
  command.captureMode,
  command.customerId ?? "",
  command.language ?? "cs",
  command.expiresInSeconds?.toString() ?? "",
  command.payOperation ?? "payment",
  command.payMethod ?? "card",
  command.customExpiry ?? "",
  ...command.lines.flatMap((line) => [
    line.name,
    line.quantity.toString(),
    line.amountMinor,
    line.description ?? "",
  ]),
]

export type PreparedCsobPaymentInitialization = {
  orderReference: string
  merchantData: string
  operationContext: CustomerPaymentOperationContext
}

export type InitializedCsobPaymentOperation = Omit<
  InitializedCustomerPayment,
  "redirectUrl"
>

export class CsobEapi19CustomerPaymentAdapter implements CustomerPaymentGateway {
  readonly provider = "csob" as const

  private readonly baseUrl: string
  private readonly httpClient: CustomerPaymentHttpClient
  private readonly timeoutMs: number
  private readonly clock: () => Date

  protected constructor(private readonly config: CsobEapi19AdapterConfig) {
    customerPaymentInvariant(
      config.environment === "sandbox" || config.environment === "production",
      "CSOB_ENVIRONMENT_INVALID",
      "ČSOB environment must be explicitly set to sandbox or production.",
      "CONFIGURATION",
    )
    customerPaymentInvariant(
      MERCHANT_ID_PATTERN.test(config.merchantId),
      "CSOB_MERCHANT_ID_INVALID",
      "ČSOB merchant ID is invalid.",
      "CONFIGURATION",
    )
    customerPaymentInvariant(
      typeof config.signer?.sign === "function" &&
        typeof config.verifier?.verify === "function",
      "CSOB_SIGNATURE_PORTS_INVALID",
      "ČSOB signing and verification ports are required.",
      "CONFIGURATION",
    )

    const timeoutMs = config.timeoutMs ?? 10_000
    customerPaymentInvariant(
      Number.isInteger(timeoutMs) && timeoutMs >= 500 && timeoutMs <= 30_000,
      "CSOB_TIMEOUT_INVALID",
      "ČSOB request timeout is invalid.",
      "CONFIGURATION",
    )

    this.baseUrl = CSOB_EAPI_1_9_ENDPOINTS[config.environment]
    this.httpClient = config.httpClient ?? new FetchCustomerPaymentHttpClient()
    this.timeoutMs = timeoutMs
    this.clock = config.clock ?? (() => new Date())
  }

  async initializePayment(
    command: InitializeCustomerPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    return this.initializePaymentOperation(command)
  }

  protected async initializePaymentOperation(
    command: InitializeCustomerPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    const prepared = this.preparePaymentInitialization(command)
    const { orderReference, merchantData, operationContext } = prepared

    const request: CsobPaymentInitWire = {
      merchantId: this.config.merchantId,
      orderNo: orderReference,
      dttm: formatCsobDateTime(this.clock()),
      payOperation: command.payOperation ?? "payment",
      payMethod: command.payMethod ?? "card",
      totalAmount: minorUnitsToSafeNumber(
        command.amount.amountMinor,
        "payment amount",
        { allowZero: false },
      ),
      currency: command.amount.currencyCode,
      closePayment: command.captureMode === "automatic",
      returnUrl: command.returnUrl,
      returnMethod: resolveReturnMethod(command.returnMethod),
      cart: command.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        amount: minorUnitsToSafeNumber(line.amountMinor, "cart line amount"),
        description: line.description,
      })),
      customer: command.customer,
      order: command.order,
      merchantData,
      customerId: command.customerId,
      language: command.language ?? "cs",
      ttlSec: command.expiresInSeconds,
      logoVersion: command.logoVersion,
      colorSchemeVersion: command.colorSchemeVersion,
      customExpiry: command.customExpiry,
    }
    const signature = await this.sign(
      buildCsobPaymentInitSignatureText(request),
    )
    const snapshot = await this.sendPaymentRequest({
      path: "/payment/init",
      method: "POST",
      body: JSON.stringify({ ...request, signature }),
      operation: "write",
      responseType: "init",
    })

    customerPaymentInvariant(
      snapshot.state === "pending",
      "CSOB_PAYMENT_INIT_STATE_INVALID",
      "ČSOB initialized payment in an unexpected state.",
      "UNKNOWN",
    )

    return {
      ...snapshot,
      ...(snapshot.customerCode
        ? {
            payByLinkUrl: `${CSOB_CUSTOM_PAYMENT_URLS[this.config.environment]}/${snapshot.customerCode}`,
          }
        : {}),
      orderReference,
      merchantData,
      operationContext,
    }
  }

  preparePaymentInitialization(
    command: InitializeCustomerPaymentCommand,
  ): PreparedCsobPaymentInitialization {
    assertInitializationCommand(
      command,
      this.config.environment === "sandbox" &&
        this.config.allowInsecureLocalReturnUrl === true,
    )

    const orderReference = deriveCsobOrderReference({
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      orderReference: command.orderReference,
    })
    const merchantData = buildCsobMerchantData({
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
    })
    const operationContext = createPaymentOperationContext({
      operation: "initialize",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      values: operationContextValuesForInitialization({
        command,
        orderReference,
      }),
    })

    return {
      orderReference,
      merchantData,
      operationContext,
    }
  }

  private prepareOperation({
    operation,
    idempotencyKey,
    correlationId,
    orderReference,
    values,
  }: {
    operation: string
    idempotencyKey: string
    correlationId: string
    orderReference?: string
    values: string[]
  }): PreparedCsobPaymentInitialization {
    const resolvedOrderReference = deriveCsobOrderReference({
      idempotencyKey,
      correlationId,
      orderReference,
    })
    const merchantData = buildCsobMerchantData({
      idempotencyKey,
      correlationId,
    })
    return {
      orderReference: resolvedOrderReference,
      merchantData,
      operationContext: createPaymentOperationContext({
        operation,
        idempotencyKey,
        correlationId,
        values: [resolvedOrderReference, ...values],
      }),
    }
  }

  async createPaymentRedirectUrl(providerPaymentId: string): Promise<string> {
    assertCsobPayId(providerPaymentId)
    return this.createProcessUrl(providerPaymentId)
  }

  async getPaymentStatus(
    command: GetCustomerPaymentStatusCommand,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    const dttm = formatCsobDateTime(this.clock())
    const signature = await this.sign(
      buildCsobPaymentOperationSignatureText({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        dttm,
      }),
    )
    const path = [
      "/payment/status",
      this.config.merchantId,
      command.providerPaymentId,
      dttm,
      signature,
    ]
      .map((value, index) => (index === 0 ? value : encodeURIComponent(value)))
      .join("/")

    return this.sendPaymentRequest({
      path,
      method: "GET",
      operation: "read",
      responseType: "payment",
      expectedPayId: command.providerPaymentId,
      reconciliation: command.reconciliation,
    })
  }

  async verifyPaymentStatus(
    command: VerifyCustomerPaymentStatusCommand,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    const returned = parseCsobReturnPayload(command.returnPayload)
    customerPaymentInvariant(
      returned.payId === command.providerPaymentId,
      "CSOB_RETURN_PAY_ID_MISMATCH",
      "ČSOB return payload does not match the expected payment.",
    )
    await this.verifySignature(
      buildCsobReturnSignatureText(returned),
      returned.signature,
      "CSOB_RETURN_SIGNATURE_INVALID",
    )
    customerPaymentInvariant(
      returned.merchantData !== undefined,
      "CSOB_RETURN_CORRELATION_MISSING",
      "ČSOB return payload is missing correlation data.",
    )
    verifyCsobMerchantData({
      merchantData: returned.merchantData,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
    })
    mapCsobPaymentState(returned.paymentStatus, command.reconciliation)

    return this.getPaymentStatus({
      providerPaymentId: command.providerPaymentId,
      reconciliation: command.reconciliation,
    })
  }

  async capturePayment(
    command: CaptureCustomerPaymentCommand,
  ): Promise<CustomerPaymentSnapshot> {
    const amount =
      command.amountMinor === undefined
        ? undefined
        : minorUnitsToSafeNumber(command.amountMinor, "capture amount", {
            allowZero: false,
          })
    const operationContext = createPaymentOperationContext({
      operation: "capture",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      values: [command.providerPaymentId, command.amountMinor ?? "full"],
    })

    return this.managePayment({
      path: "/payment/close",
      command,
      operationContext,
      amount,
      amountField: "totalAmount",
    })
  }

  async cancelPayment(
    command: CancelCustomerPaymentCommand,
  ): Promise<CustomerPaymentSnapshot> {
    const operationContext = createPaymentOperationContext({
      operation: "cancel",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      values: [command.providerPaymentId],
    })

    return this.managePayment({
      path: "/payment/reverse",
      command,
      operationContext,
    })
  }

  async refundPayment(
    command: RefundCustomerPaymentCommand,
  ): Promise<CustomerPaymentSnapshot> {
    let amount: number | undefined
    let reconciliation: CustomerPaymentReconciliation | undefined
    let fingerprintValues: string[]

    if (command.kind === "partial") {
      const captured = parseMinorUnits(
        command.capturedAmountMinor,
        "captured amount",
        { allowZero: false },
      )
      const alreadyRefunded = parseMinorUnits(
        command.alreadyRefundedAmountMinor,
        "already refunded amount",
      )
      const refund = parseMinorUnits(command.amountMinor, "refund amount", {
        allowZero: false,
      })
      customerPaymentInvariant(
        alreadyRefunded < captured && refund < captured - alreadyRefunded,
        "CSOB_PARTIAL_REFUND_INVALID",
        "ČSOB partial refund must be lower than the remaining captured amount.",
      )

      const refundedAmountMinor = (alreadyRefunded + refund).toString()
      amount = minorUnitsToSafeNumber(command.amountMinor, "refund amount", {
        allowZero: false,
      })
      reconciliation = {
        capturedAmountMinor: command.capturedAmountMinor,
        refundedAmountMinor,
      }
      fingerprintValues = [
        command.providerPaymentId,
        "partial",
        command.amountMinor,
        command.capturedAmountMinor,
        command.alreadyRefundedAmountMinor,
      ]
    } else {
      fingerprintValues = [command.providerPaymentId, "full"]
    }

    const operationContext = createPaymentOperationContext({
      operation: "refund",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      values: fingerprintValues,
    })

    return this.managePayment({
      path: "/payment/refund",
      command,
      operationContext,
      amount,
      amountField: "amount",
      reconciliation,
    })
  }

  async echo(httpMethod: "GET" | "POST" = "POST"): Promise<CsobEchoResult> {
    if (httpMethod === "GET") {
      const dttm = formatCsobDateTime(this.clock())
      const signature = await this.sign(
        buildCsobEchoSignatureText({
          merchantId: this.config.merchantId,
          dttm,
        }),
      )
      const snapshot = await this.sendPaymentRequest({
        path: `/echo/${encodeURIComponent(this.config.merchantId)}/${dttm}/${encodeURIComponent(signature)}`,
        method: "GET",
        operation: "read",
        responseType: "echo",
        acceptNonZeroResult: true,
      })
      return {
        provider: "csob",
        providerTimestamp: snapshot.providerTimestamp,
        providerResultCode: snapshot.providerResultCode,
        resultMessage: snapshot.resultMessage ?? "OK",
        initParams: snapshot.initParams,
        extensions: snapshot.extensions,
      }
    }
    return this.sendEcho({
      path: "/echo",
      method: "POST",
      responseType: "echo",
    })
  }

  async echoCustomer(customerId: string): Promise<CsobEchoResult> {
    customerPaymentInvariant(
      CUSTOMER_ID_PATTERN.test(customerId) && customerId.length <= 50,
      "CSOB_CUSTOMER_ID_INVALID",
      "ČSOB customer ID is invalid.",
    )
    return this.sendEcho({
      path: "/echo/customer",
      method: "POST",
      responseType: "echoCustomer",
      extra: { customerId },
      customerId,
    })
  }

  async echoOneClick(origPayId: string): Promise<CsobEchoResult> {
    assertCsobPayId(origPayId)
    return this.sendEcho({
      path: "/oneclick/echo",
      method: "POST",
      responseType: "oneclickEcho",
      extra: { origPayId },
      origPayId,
    })
  }

  async echoApplePay(): Promise<CsobEchoResult> {
    return this.sendEcho({
      path: "/applepay/echo",
      method: "POST",
      responseType: "applepayEcho",
    })
  }

  async echoGooglePay(): Promise<CsobEchoResult> {
    return this.sendEcho({
      path: "/googlepay/echo",
      method: "POST",
      responseType: "googlepayEcho",
    })
  }

  async initializeOneClickPayment(
    command: InitializeOneClickPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    assertCsobPayId(command.origPayId)
    if (command.clientInitiated !== false) {
      customerPaymentInvariant(
        command.clientIp !== undefined,
        "CSOB_CLIENT_IP_INVALID",
        "ČSOB OneClick customer-initiated payments require a client IP.",
      )
    }
    if (command.clientIp) {
      assertCsobClientIp(command.clientIp)
    }
    if (command.returnUrl) {
      assertReturnUrl(
        command.returnUrl,
        this.config.environment === "sandbox" &&
          this.config.allowInsecureLocalReturnUrl === true,
      )
    }
    if (command.language) {
      assertCsobLanguage(command.language)
    }
    assertCsobPurchaseCustomer(command.customer)
    assertCsobPurchaseOrder(command.order)
    const prepared = this.prepareOperation({
      operation: "oneclick-init",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      orderReference: command.orderReference,
      values: [
        command.origPayId,
        command.amount?.amountMinor ?? "",
        command.clientIp ?? "",
      ],
    })
    const dttm = formatCsobDateTime(this.clock())
    const request = {
      merchantId: this.config.merchantId,
      origPayId: command.origPayId,
      orderNo: prepared.orderReference,
      dttm,
      payMethod: command.payMethod,
      clientIp: command.clientIp,
      totalAmount: command.amount
        ? minorUnitsToSafeNumber(command.amount.amountMinor, "payment amount", {
            allowZero: false,
          })
        : undefined,
      currency: command.amount?.currencyCode,
      closePayment:
        command.captureMode === undefined
          ? undefined
          : command.captureMode === "automatic",
      returnUrl: command.returnUrl,
      returnMethod: command.returnUrl
        ? resolveReturnMethod(command.returnMethod)
        : undefined,
      customer: command.customer,
      order: command.order,
      clientInitiated: command.clientInitiated,
      sdkUsed: command.sdkUsed,
      merchantData: prepared.merchantData,
      language: command.language,
      ttlSec: command.expiresInSeconds,
    }
    const signature = await this.sign(
      buildCsobOneClickInitSignatureText(request),
    )
    const snapshot = await this.sendPaymentRequest({
      path: "/oneclick/init",
      method: "POST",
      body: JSON.stringify({ ...request, signature }),
      operation: "write",
      responseType: "process",
    })
    return {
      ...snapshot,
      orderReference: prepared.orderReference,
      merchantData: prepared.merchantData,
      operationContext: prepared.operationContext,
    }
  }

  async processOneClickPayment(
    command: ProcessAuthenticatedPaymentCommand,
  ): Promise<CustomerPaymentSnapshot> {
    return this.processAuthenticatedPayment("/oneclick/process", command)
  }

  async initializeApplePay(
    command: InitializeWalletPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    return this.initializeWalletPayment("/applepay/init", command)
  }

  async processApplePay(
    command: ProcessAuthenticatedPaymentCommand,
  ): Promise<CustomerPaymentSnapshot> {
    return this.processAuthenticatedPayment("/applepay/process", command, true)
  }

  async initializeGooglePay(
    command: InitializeWalletPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    return this.initializeWalletPayment("/googlepay/init", command)
  }

  async processGooglePay(
    command: ProcessAuthenticatedPaymentCommand,
  ): Promise<CustomerPaymentSnapshot> {
    return this.processAuthenticatedPayment("/googlepay/process", command, true)
  }

  async initializePaymentButton(
    command: InitializeButtonPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    assertCsobClientIp(command.clientIp)
    customerPaymentInvariant(
      command.amount.currencyCode === "CZK",
      "CSOB_CURRENCY_UNSUPPORTED",
      "ČSOB payment button supports CZK only.",
    )
    assertReturnUrl(
      command.returnUrl,
      this.config.environment === "sandbox" &&
        this.config.allowInsecureLocalReturnUrl === true,
    )
    if (command.language) {
      assertCsobLanguage(command.language)
    }
    const prepared = this.prepareOperation({
      operation: "button-init",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      orderReference: command.orderReference,
      values: [command.amount.amountMinor, command.clientIp],
    })
    const request = {
      merchantId: this.config.merchantId,
      orderNo: prepared.orderReference,
      dttm: formatCsobDateTime(this.clock()),
      clientIp: command.clientIp,
      totalAmount: minorUnitsToSafeNumber(
        command.amount.amountMinor,
        "payment amount",
        { allowZero: false },
      ),
      currency: command.amount.currencyCode,
      returnUrl: command.returnUrl,
      returnMethod: resolveReturnMethod(command.returnMethod),
      brand: command.brand,
      merchantData: prepared.merchantData,
      language: command.language ?? "cs",
    }
    const signature = await this.sign(buildCsobButtonInitSignatureText(request))
    const snapshot = await this.sendPaymentRequest({
      path: "/button/init",
      method: "POST",
      body: JSON.stringify({ ...request, signature }),
      operation: "write",
      responseType: "button",
    })
    return {
      ...snapshot,
      orderReference: prepared.orderReference,
      merchantData: prepared.merchantData,
      operationContext: prepared.operationContext,
    }
  }

  async initializeMallpay(
    command: InitializeMallpayPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    assertCsobClientIp(command.clientIp)
    customerPaymentInvariant(
      command.customer !== undefined && command.order !== undefined,
      "CSOB_MALLPAY_ORDER_INVALID",
      "ČSOB Skip Pay customer and order are required.",
    )
    assertCsobMallpayCustomer(command.customer)
    assertCsobMallpayOrder(command.order)
    customerPaymentInvariant(
      command.agreeTC === true,
      "CSOB_MALLPAY_TERMS_REQUIRED",
      "ČSOB Skip Pay requires the customer to accept the terms.",
    )
    assertReturnUrl(
      command.returnUrl,
      this.config.environment === "sandbox" &&
        this.config.allowInsecureLocalReturnUrl === true,
    )
    const prepared = this.prepareOperation({
      operation: "mallpay-init",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      orderReference: command.orderReference,
      values: [command.order.totalPrice.amountMinor, command.clientIp],
    })
    const request = {
      merchantId: this.config.merchantId,
      orderNo: prepared.orderReference,
      customer: command.customer,
      order: command.order,
      agreeTC: command.agreeTC,
      dttm: formatCsobDateTime(this.clock()),
      clientIp: command.clientIp,
      returnUrl: command.returnUrl,
      returnMethod: resolveReturnMethod(command.returnMethod),
      merchantData: prepared.merchantData,
      ttlSec: command.expiresInSeconds,
    }
    const signature = await this.sign(
      buildCsobMallpayInitSignatureText(request),
    )
    const snapshot = await this.sendPaymentRequest({
      path: "/mallpay/init",
      method: "POST",
      body: JSON.stringify({ ...request, signature }),
      operation: "write",
      responseType: "mallpayInit",
    })
    return {
      ...snapshot,
      orderReference: prepared.orderReference,
      merchantData: prepared.merchantData,
      operationContext: prepared.operationContext,
    }
  }

  async cancelMallpay(
    command: MallpayCancelCommand,
  ): Promise<CustomerPaymentSnapshot> {
    return this.sendReasonedWrite("/mallpay/cancel", command, command.reason)
  }

  async updateMallpayLogistics(
    command: MallpayLogisticsCommand,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    assertCsobCalendarDate(command.date)
    const dttm = formatCsobDateTime(this.clock())
    const payload = {
      merchantId: this.config.merchantId,
      payId: command.providerPaymentId,
      event: command.event,
      date: command.date,
      fulfilled: command.fulfilled,
      cancelled: command.cancelled,
      deliveryTrackingNumber: command.deliveryTrackingNumber,
      dttm,
    }
    const signature = await this.sign(
      buildCsobMallpayLogisticsSignatureText(payload),
    )
    return this.sendPaymentRequest({
      path: "/mallpay/logistics",
      method: "PUT",
      body: JSON.stringify({ ...payload, signature }),
      operation: "write",
      responseType: "payment",
      expectedPayId: command.providerPaymentId,
    })
  }

  async refundMallpay(
    command: MallpayRefundCommand,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    const amount =
      command.amountMinor === undefined
        ? undefined
        : minorUnitsToSafeNumber(command.amountMinor, "refund amount", {
            allowZero: false,
          })
    const dttm = formatCsobDateTime(this.clock())
    const payload = {
      merchantId: this.config.merchantId,
      payId: command.providerPaymentId,
      dttm,
      amount,
      refundedItems: command.refundedItems,
    }
    const signature = await this.sign(
      buildCsobMallpayRefundSignatureText(payload),
    )
    return this.sendPaymentRequest({
      path: "/mallpay/refund",
      method: "PUT",
      body: JSON.stringify({ ...payload, signature }),
      operation: "write",
      responseType: "payment",
      expectedPayId: command.providerPaymentId,
    })
  }

  async initializeLoan(
    command: InitializeLoanPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    assertCsobClientIp(command.clientIp)
    assertCsobLoanCustomer(command.customer)
    customerPaymentInvariant(
      /^\S.{0,34}\S$/.test(command.purchaseId) &&
        command.purchaseId.length <= 36,
      "CSOB_LOAN_PURCHASE_ID_INVALID",
      "ČSOB loan purchase ID is invalid.",
    )
    assertReturnUrl(
      command.returnUrl,
      this.config.environment === "sandbox" &&
        this.config.allowInsecureLocalReturnUrl === true,
    )
    if (command.language) {
      assertCsobLanguage(command.language)
    }
    const prepared = this.prepareOperation({
      operation: "loan-init",
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      orderReference: command.orderReference,
      values: [
        command.purchaseId,
        command.amount.amountMinor,
        command.clientIp,
      ],
    })
    const request = {
      merchantId: this.config.merchantId,
      orderNo: prepared.orderReference,
      purchaseId: command.purchaseId,
      dttm: formatCsobDateTime(this.clock()),
      clientIp: command.clientIp,
      totalAmount: minorUnitsToSafeNumber(
        command.amount.amountMinor,
        "payment amount",
        { allowZero: false },
      ),
      currency: command.amount.currencyCode,
      returnUrl: command.returnUrl,
      returnMethod: resolveReturnMethod(command.returnMethod),
      customer: command.customer,
      merchantData: prepared.merchantData,
      language: command.language ?? "cs",
    }
    const signature = await this.sign(buildCsobLoanInitSignatureText(request))
    const snapshot = await this.sendPaymentRequest({
      path: "/loan/init",
      method: "POST",
      body: JSON.stringify({ ...request, signature }),
      operation: "write",
      responseType: "loanInit",
    })
    return {
      ...snapshot,
      orderReference: prepared.orderReference,
      merchantData: prepared.merchantData,
      operationContext: prepared.operationContext,
    }
  }

  async cancelLoan(
    command: MallpayCancelCommand,
  ): Promise<CustomerPaymentSnapshot> {
    return this.sendReasonedWrite("/loan/cancel", command, command.reason)
  }

  async updateLoanLogistics(
    command: LoanLogisticsCommand,
  ): Promise<CustomerPaymentSnapshot> {
    return this.sendReasonedWrite(
      "/loan/logistics",
      command,
      undefined,
      command.event,
    )
  }

  async refundLoan(
    command: LoanRefundCommand,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    if (command.date) {
      assertCsobCalendarDate(command.date)
    }
    const amount =
      command.amountMinor === undefined
        ? undefined
        : minorUnitsToSafeNumber(command.amountMinor, "refund amount", {
            allowZero: false,
          })
    const dttm = formatCsobDateTime(this.clock())
    const payload = {
      merchantId: this.config.merchantId,
      payId: command.providerPaymentId,
      dttm,
      amount,
      reason: command.reason,
      date: command.date,
    }
    const signature = await this.sign(buildCsobLoanRefundSignatureText(payload))
    return this.sendPaymentRequest({
      path: "/loan/refund",
      method: "PUT",
      body: JSON.stringify({ ...payload, signature }),
      operation: "write",
      responseType: "payment",
      expectedPayId: command.providerPaymentId,
    })
  }

  private async initializeWalletPayment(
    path: "/applepay/init" | "/googlepay/init",
    command: InitializeWalletPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    assertCsobClientIp(command.clientIp)
    customerPaymentInvariant(
      isCanonicalBase64(command.payload),
      "CSOB_WALLET_PAYLOAD_INVALID",
      "ČSOB wallet payload must be canonical Base64.",
    )
    assertReturnUrl(
      command.returnUrl,
      this.config.environment === "sandbox" &&
        this.config.allowInsecureLocalReturnUrl === true,
    )
    if (command.language) {
      assertCsobLanguage(command.language)
    }
    assertCsobPurchaseCustomer(command.customer)
    assertCsobPurchaseOrder(command.order)
    const prepared = this.prepareOperation({
      operation: path,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      orderReference: command.orderReference,
      values: [command.amount.amountMinor, command.clientIp],
    })
    const request = {
      merchantId: this.config.merchantId,
      orderNo: prepared.orderReference,
      dttm: formatCsobDateTime(this.clock()),
      clientIp: command.clientIp,
      totalAmount: minorUnitsToSafeNumber(
        command.amount.amountMinor,
        "payment amount",
        { allowZero: false },
      ),
      currency: command.amount.currencyCode,
      closePayment: command.captureMode === "automatic",
      payload: command.payload,
      returnUrl: command.returnUrl,
      returnMethod: resolveReturnMethod(command.returnMethod),
      customer: command.customer,
      order: command.order,
      sdkUsed: command.sdkUsed,
      merchantData: prepared.merchantData,
      language: command.language,
      ttlSec: command.expiresInSeconds,
    }
    const signature = await this.sign(buildCsobWalletInitSignatureText(request))
    const snapshot = await this.sendPaymentRequest({
      path,
      method: "POST",
      body: JSON.stringify({ ...request, signature }),
      operation: "write",
      responseType: "process",
    })
    return {
      ...snapshot,
      orderReference: prepared.orderReference,
      merchantData: prepared.merchantData,
      operationContext: prepared.operationContext,
    }
  }

  private async processAuthenticatedPayment(
    path: string,
    command: ProcessAuthenticatedPaymentCommand,
    fingerprintRequired = false,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    if (fingerprintRequired || command.fingerprint) {
      customerPaymentInvariant(
        command.fingerprint !== undefined,
        "CSOB_FINGERPRINT_INVALID",
        "ČSOB process requires fingerprint data.",
      )
      assertCsobAuthFingerprint(command.fingerprint)
    }
    const dttm = formatCsobDateTime(this.clock())
    const signature = await this.sign(
      buildCsobProcessSignatureText({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        dttm,
        fingerprint: command.fingerprint,
      }),
    )
    return this.sendPaymentRequest({
      path,
      method: "POST",
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        dttm,
        fingerprint: command.fingerprint,
        signature,
      }),
      operation: "write",
      responseType: "process",
      expectedPayId: command.providerPaymentId,
    })
  }

  private async sendReasonedWrite(
    path: string,
    command: {
      providerPaymentId: string
      idempotencyKey: string
      correlationId: string
    },
    reason?: string,
    event?: string,
  ): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    const dttm = formatCsobDateTime(this.clock())
    const signature = await this.sign(
      buildCsobReasonedOperationSignatureText({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        reason,
        event,
        dttm,
      }),
    )
    return this.sendPaymentRequest({
      path,
      method: "PUT",
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        reason,
        event,
        dttm,
        signature,
      }),
      operation: "write",
      responseType: "payment",
      expectedPayId: command.providerPaymentId,
    })
  }

  private async sendEcho({
    path,
    method,
    responseType,
    extra,
    customerId,
    origPayId,
  }: {
    path: string
    method: "GET" | "POST"
    responseType: CsobApiResponseKind
    extra?: Record<string, string>
    customerId?: string
    origPayId?: string
  }): Promise<CsobEchoResult> {
    const dttm = formatCsobDateTime(this.clock())
    const signature = await this.sign(
      buildCsobEchoSignatureText({
        merchantId: this.config.merchantId,
        dttm,
        customerId,
        origPayId,
      }),
    )
    const snapshot = await this.sendPaymentRequest({
      path,
      method,
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        dttm,
        ...extra,
        signature,
      }),
      operation: "read",
      responseType,
      acceptNonZeroResult: true,
    })
    return {
      provider: "csob",
      providerTimestamp: snapshot.providerTimestamp,
      providerResultCode: snapshot.providerResultCode,
      resultMessage: snapshot.resultMessage ?? "OK",
      origPayId,
      customerId,
      initParams: snapshot.initParams,
      extensions: snapshot.extensions,
    }
  }

  private async createProcessUrl(payId: string): Promise<string> {
    const dttm = formatCsobDateTime(this.clock())
    const signature = await this.sign(
      buildCsobPaymentOperationSignatureText({
        merchantId: this.config.merchantId,
        payId,
        dttm,
      }),
    )

    return [
      `${this.baseUrl}/payment/process`,
      this.config.merchantId,
      payId,
      dttm,
      signature,
    ]
      .map((value, index) => (index === 0 ? value : encodeURIComponent(value)))
      .join("/")
  }

  private async managePayment({
    path,
    command,
    operationContext,
    amount,
    amountField,
    reconciliation,
  }: {
    path: string
    command:
      | CaptureCustomerPaymentCommand
      | CancelCustomerPaymentCommand
      | RefundCustomerPaymentCommand
    operationContext: CustomerPaymentOperationContext
    amount?: number
    amountField?: "totalAmount" | "amount"
    reconciliation?: CustomerPaymentReconciliation
  }): Promise<CustomerPaymentSnapshot> {
    assertCsobPayId(command.providerPaymentId)
    const dttm = formatCsobDateTime(this.clock())
    const signature = await this.sign(
      buildCsobPaymentOperationSignatureText({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        dttm,
        amount,
      }),
    )
    const amountPayload =
      amount !== undefined && amountField ? { [amountField]: amount } : {}
    const snapshot = await this.sendPaymentRequest({
      path,
      method: "PUT",
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        payId: command.providerPaymentId,
        dttm,
        ...amountPayload,
        signature,
      }),
      operation: "write",
      responseType: "payment",
      expectedPayId: command.providerPaymentId,
      reconciliation,
    })

    return { ...snapshot, operationContext }
  }

  private async sendPaymentRequest({
    path,
    method,
    body,
    operation,
    responseType,
    expectedPayId,
    reconciliation,
    acceptNonZeroResult,
  }: SendPaymentRequestInput): Promise<CustomerPaymentSnapshot> {
    let httpResponse: CustomerPaymentHttpResponse
    try {
      httpResponse = await this.httpClient.send({
        url: `${this.baseUrl}${path}`,
        method,
        headers: {
          accept: "application/json",
          ...(body
            ? { "content-type": "application/json; charset=utf-8" }
            : {}),
        },
        body,
        timeoutMs: this.timeoutMs,
      })
    } catch (error) {
      throw asCustomerPaymentIntegrationError(error, operation)
    }

    const response = parseCsobApiResponse({
      response: httpResponse,
      operation,
      kind: responseType,
    })
    await this.verifySignature(
      buildCsobPaymentResponseSignatureText(response, responseType),
      response.signature,
      "CSOB_RESPONSE_SIGNATURE_INVALID",
    )

    if (expectedPayId !== undefined) {
      customerPaymentInvariant(
        response.payId === expectedPayId,
        "CSOB_RESPONSE_PAY_ID_MISMATCH",
        "ČSOB response does not match the requested payment.",
        "UNKNOWN",
      )
    }
    if (response.resultCode !== 0 && !acceptNonZeroResult) {
      throw new CustomerPaymentIntegrationError({
        code: "CSOB_OPERATION_REJECTED",
        message: "ČSOB rejected the payment operation.",
        providerResultCode: response.resultCode.toString(),
      })
    }

    return this.toSnapshot(response, reconciliation)
  }

  private toSnapshot(
    response: CsobPaymentResponseWire,
    reconciliation?: CustomerPaymentReconciliation,
  ): CustomerPaymentSnapshot {
    const paymentStatus = response.paymentStatus
    return {
      provider: this.provider,
      providerPaymentId: response.payId,
      state:
        response.payId && paymentStatus
          ? mapCsobPaymentState(paymentStatus, reconciliation)
          : "pending",
      providerStatusCode: paymentStatus.toString(),
      providerTimestamp: response.dttm,
      providerResultCode: response.resultCode.toString(),
      authorizationCode: response.authCode,
      statusDetail: response.statusDetail,
      resultMessage: response.resultMessage,
      initParams: response.initParams,
      actions: response.actions,
      customerCode: response.customerCode,
      redirect: response.redirect,
      mallpayUrl: response.mallpayUrl,
      comparisonUrl: response.comparisonUrl,
      extensions: response.extensions,
    }
  }

  private async sign(textToSign: string): Promise<string> {
    let signature: string
    try {
      signature = await this.config.signer.sign(textToSign)
    } catch {
      throw new CustomerPaymentIntegrationError({
        code: "CSOB_REQUEST_SIGNING_FAILED",
        message: "ČSOB request could not be signed.",
        outcome: "CONFIGURATION",
      })
    }

    customerPaymentInvariant(
      typeof signature === "string" && isCanonicalBase64(signature),
      "CSOB_REQUEST_SIGNATURE_INVALID",
      "ČSOB request signer returned an invalid signature.",
      "CONFIGURATION",
    )
    return signature
  }

  private async verifySignature(
    textToSign: string,
    signature: string,
    errorCode: string,
  ): Promise<void> {
    let valid: boolean
    try {
      valid = await this.config.verifier.verify(textToSign, signature)
    } catch {
      throw new CustomerPaymentIntegrationError({
        code: "CSOB_RESPONSE_VERIFICATION_FAILED",
        message: "ČSOB response signature could not be verified.",
        outcome: "UNKNOWN",
      })
    }

    customerPaymentInvariant(
      valid,
      errorCode,
      "ČSOB response signature is invalid.",
      "UNKNOWN",
    )
  }
}

export class CsobEapi19CustomerPaymentGateway extends CsobEapi19CustomerPaymentAdapter {
  constructor(config: CsobEapi19AdapterConfig) {
    super(config)
  }
}

export const createCsobEapi19CustomerPaymentStatusGateway = (
  config: CsobEapi19AdapterConfig,
): CustomerPaymentStatusGateway => {
  const adapter = new CsobEapi19CustomerPaymentGateway(config)

  return Object.freeze({
    provider: adapter.provider,
    getPaymentStatus: adapter.getPaymentStatus.bind(adapter),
    verifyPaymentStatus: adapter.verifyPaymentStatus.bind(adapter),
  })
}

export const createCsobEapi19CustomerPaymentGateway = (
  config: CsobEapi19AdapterConfig,
): CsobEapi19CustomerPaymentGateway =>
  new CsobEapi19CustomerPaymentGateway(config)
