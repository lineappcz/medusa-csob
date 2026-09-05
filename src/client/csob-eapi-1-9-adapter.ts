import {
  CSOB_CURRENCIES,
  CSOB_EAPI_1_9_ENDPOINTS,
  CSOB_LANGUAGES,
  type CsobEnvironment,
} from "./csob-constants"
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
} from "./csob-response"
import {
  buildCsobPaymentInitSignatureText,
  buildCsobPaymentOperationSignatureText,
  buildCsobPaymentResponseSignatureText,
  buildCsobReturnSignatureText,
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
  CustomerPaymentGateway,
  CustomerPaymentStatusGateway,
  CustomerPaymentOperationContext,
  CustomerPaymentReconciliation,
  CustomerPaymentSnapshot,
  GetCustomerPaymentStatusCommand,
  InitializedCustomerPayment,
  InitializeCustomerPaymentCommand,
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
  responseType: "init" | "payment"
  expectedPayId?: string
  reconciliation?: CustomerPaymentReconciliation
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

  protected async initializePaymentOperation(
    command: InitializeCustomerPaymentCommand,
  ): Promise<InitializedCsobPaymentOperation> {
    const prepared = this.preparePaymentInitialization(command)
    const { orderReference, merchantData, operationContext } = prepared

    const request: CsobPaymentInitWire = {
      merchantId: this.config.merchantId,
      orderNo: orderReference,
      dttm: formatCsobDateTime(this.clock()),
      payOperation: "payment",
      payMethod: "card",
      totalAmount: minorUnitsToSafeNumber(
        command.amount.amountMinor,
        "payment amount",
        { allowZero: false },
      ),
      currency: command.amount.currencyCode,
      closePayment: command.captureMode === "automatic",
      returnUrl: command.returnUrl,
      returnMethod: "POST",
      cart: command.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        amount: minorUnitsToSafeNumber(line.amountMinor, "cart line amount"),
        description: line.description,
      })),
      merchantData,
      customerId: command.customerId,
      language: command.language ?? "cs",
      ttlSec: command.expiresInSeconds,
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
    if (response.resultCode !== 0) {
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
    return {
      provider: this.provider,
      providerPaymentId: response.payId,
      state: mapCsobPaymentState(response.paymentStatus, reconciliation),
      providerStatusCode: response.paymentStatus.toString(),
      providerTimestamp: response.dttm,
      providerResultCode: response.resultCode.toString(),
      authorizationCode: response.authCode,
      statusDetail: response.statusDetail,
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

class PublicCsobEapi19CustomerPaymentGateway extends CsobEapi19CustomerPaymentAdapter {
  constructor(config: CsobEapi19AdapterConfig) {
    super(config)
  }
}

export const createCsobEapi19CustomerPaymentStatusGateway = (
  config: CsobEapi19AdapterConfig,
): CustomerPaymentStatusGateway => {
  const adapter = new PublicCsobEapi19CustomerPaymentGateway(config)

  return Object.freeze({
    provider: adapter.provider,
    getPaymentStatus: adapter.getPaymentStatus.bind(adapter),
    verifyPaymentStatus: adapter.verifyPaymentStatus.bind(adapter),
  })
}
