import { MedusaError } from "@medusajs/framework/utils"
import {
  AbstractPaymentProvider,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  RefundPaymentInput,
  CancelPaymentInput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  RetrievePaymentInput,
  UpdatePaymentInput,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  CsobEapi19CustomerPaymentAdapter,
  type CsobEapi19AdapterConfig,
} from "../client/csob-eapi-1-9-adapter"
import type {
  InitializeCustomerPaymentCommand,
  CustomerPaymentSnapshot,
} from "../client"
import { medusaAmountToCsobMinorUnits } from "./amount"
import {
  assertCsobReturnUrlAllowed,
  createCsobSignatureService,
  resolveCsobPaymentProviderOptions,
  type CsobPaymentProviderOptions,
} from "./options"
import {
  RedisOperationStore,
  type OperationStore,
  type OperationState,
} from "./operation-store"

export type CsobProviderOptions = CsobPaymentProviderOptions & {
  return_url: string
  redis_url?: string
  operation_store?: OperationStore
  namespace: string
  capture_mode?: "automatic" | "manual"
  description?: string
}

class Gateway extends CsobEapi19CustomerPaymentAdapter {
  constructor(config: CsobEapi19AdapterConfig) {
    super(config)
  }
  initialize(command: InitializeCustomerPaymentCommand) {
    return this.initializePaymentOperation(command)
  }
}

type Session = OperationState & {
  sessionId: string
  payId: string
  amountMinor: string
  currency: string
  refundedMinor: string
  redirectUrl: string
}

const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Payment session identity is required",
    )
  return value
}
const statusOf = (snapshot: CustomerPaymentSnapshot): PaymentSessionStatus => {
  if (snapshot.state === "authorized") return PaymentSessionStatus.AUTHORIZED
  if (
    [
      "captured",
      "paid",
      "refund_pending",
      "partially_refunded",
      "refunded",
    ].includes(snapshot.state)
  )
    return PaymentSessionStatus.CAPTURED
  if (snapshot.state === "cancelled") return PaymentSessionStatus.CANCELED
  if (snapshot.state === "failed") return PaymentSessionStatus.ERROR
  return PaymentSessionStatus.PENDING
}

export default class CsobProvider extends AbstractPaymentProvider<CsobProviderOptions> {
  static identifier = "csob"
  private readonly gateway: Gateway
  private readonly store: OperationStore
  private readonly options_: CsobProviderOptions

  static validateOptions(options: Record<string, unknown>) {
    const parsed = resolveCsobPaymentProviderOptions(
      options as unknown as CsobProviderOptions,
    )
    assertCsobReturnUrlAllowed(required(options.return_url), parsed)
    if (!options.namespace || (!options.redis_url && !options.operation_store))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Durable operation storage and namespace are required",
      )
    if (
      options.capture_mode &&
      !["automatic", "manual"].includes(String(options.capture_mode))
    )
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Unknown capture mode",
      )
  }
  constructor(
    container: Record<string, unknown>,
    options: CsobProviderOptions,
  ) {
    super(container, options)
    CsobProvider.validateOptions(options as unknown as Record<string, unknown>)
    this.options_ = options
    const resolved = resolveCsobPaymentProviderOptions(options)
    const signature = createCsobSignatureService(resolved)
    this.gateway = new Gateway({
      environment: options.environment,
      merchantId: options.merchant_id,
      signer: signature,
      verifier: signature,
      httpClient: options.http_client,
      clock: options.clock,
      timeoutMs: options.timeout_ms,
      allowInsecureLocalReturnUrl: options.allow_insecure_local_return_url,
    })
    this.store =
      options.operation_store ??
      new RedisOperationStore(
        options.redis_url!,
        `${options.namespace}:csob:${options.environment}:${options.merchant_id}`,
      )
  }
  private async session(data?: Record<string, unknown>): Promise<Session> {
    const sessionId = required(data?.session_id)
    const stored = await this.store.read(sessionId)
    if (stored.sessionId !== sessionId || stored.payId !== data?.pay_id)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Unknown or mismatched payment session",
      )
    return stored as Session
  }
  private data(session: Session): Record<string, unknown> {
    return {
      session_id: session.sessionId,
      pay_id: session.payId,
      redirect_url: session.redirectUrl,
    }
  }
  async initiatePayment(
    input: InitiatePaymentInput,
  ): Promise<InitiatePaymentOutput> {
    if (this.options_.maintenance_mode)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment checkout is in maintenance mode",
      )
    const sessionId = required(input.context?.idempotency_key)
    const amountMinor = medusaAmountToCsobMinorUnits(
      input.amount,
      input.currency_code,
    )
    const currency = input.currency_code.toUpperCase()
    const command: InitializeCustomerPaymentCommand = {
      amount: { amountMinor, currencyCode: currency },
      lines: [
        {
          name: this.options_.description ?? "Order",
          quantity: 1,
          amountMinor,
        },
      ],
      returnUrl: this.options_.return_url,
      captureMode: this.options_.capture_mode ?? "automatic",
      idempotencyKey: sessionId,
      correlationId: sessionId,
      language: "cs",
    }
    return this.store.run(sessionId, "init", command, async () => {
      const initialized = await this.gateway.initialize(command)
      const redirectUrl = await this.gateway.createPaymentRedirectUrl(
        initialized.providerPaymentId,
      )
      const session: Session = {
        sessionId,
        payId: initialized.providerPaymentId,
        amountMinor,
        currency,
        refundedMinor: "0",
        redirectUrl,
      }
      return {
        result: {
          id: session.payId,
          status: statusOf(initialized),
          data: this.data(session),
        },
        state: session,
      }
    })
  }
  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    const session = await this.session(input.data)
    const snapshot = await this.gateway.getPaymentStatus({
      providerPaymentId: session.payId,
      ...(session.refundedMinor !== "0"
        ? {
            reconciliation: {
              capturedAmountMinor: session.amountMinor,
              refundedAmountMinor: session.refundedMinor,
            },
          }
        : {}),
    })
    return { status: statusOf(snapshot), data: this.data(session) }
  }
  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    // Browser fields never authorize a payment. Only the signed bank status does.
    return this.getPaymentStatus(input)
  }
  async retrievePayment(input: RetrievePaymentInput) {
    return this.getPaymentStatus(input)
  }
  async updatePayment(input: UpdatePaymentInput) {
    const session = await this.session(input.data)
    const amount = medusaAmountToCsobMinorUnits(
      input.amount,
      input.currency_code,
    )
    if (
      amount !== session.amountMinor ||
      input.currency_code.toUpperCase() !== session.currency
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cancel the previous payment session before creating a session for a changed amount",
      )
    }
    return this.getPaymentStatus(input)
  }
  async capturePayment(input: CapturePaymentInput) {
    const session = await this.session(input.data)
    return this.store.run(
      session.sessionId,
      "capture",
      { payId: session.payId },
      async (current) => {
        const snapshot = await this.gateway.getPaymentStatus({
          providerPaymentId: session.payId,
          ...(session.refundedMinor !== "0"
            ? {
                reconciliation: {
                  capturedAmountMinor: session.amountMinor,
                  refundedAmountMinor: session.refundedMinor,
                },
              }
            : {}),
        })
        if (!["captured", "paid"].includes(snapshot.state)) {
          if (snapshot.state !== "authorized")
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              "Payment is not authorized for capture",
            )
          await this.gateway.capturePayment({
            providerPaymentId: session.payId,
            idempotencyKey: `${session.sessionId}:capture`,
            correlationId: session.sessionId,
          })
        }
        return { result: { data: this.data(session) }, state: current }
      },
    )
  }
  async cancelPayment(input: CancelPaymentInput) {
    const session = await this.session(input.data)
    return this.store.run(
      session.sessionId,
      "cancel",
      { payId: session.payId },
      async (current) => {
        const snapshot = await this.gateway.getPaymentStatus({
          providerPaymentId: session.payId,
          ...(session.refundedMinor !== "0"
            ? {
                reconciliation: {
                  capturedAmountMinor: session.amountMinor,
                  refundedAmountMinor: session.refundedMinor,
                },
              }
            : {}),
        })
        if (snapshot.state !== "cancelled") {
          if (
            [
              "captured",
              "paid",
              "refunded",
              "refund_pending",
              "partially_refunded",
            ].includes(snapshot.state)
          )
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              "Captured payments must be refunded",
            )
          await this.gateway.cancelPayment({
            providerPaymentId: session.payId,
            idempotencyKey: `${session.sessionId}:cancel`,
            correlationId: session.sessionId,
          })
        }
        return { result: { data: this.data(session) }, state: current }
      },
    )
  }
  async deletePayment(input: CancelPaymentInput) {
    return this.cancelPayment(input)
  }
  async refundPayment(input: RefundPaymentInput) {
    const session = await this.session(input.data)
    const operation = required(input.context?.idempotency_key)
    const amount = medusaAmountToCsobMinorUnits(input.amount, session.currency)
    return this.store.run(
      session.sessionId,
      `refund:${operation}`,
      { amount },
      async (current) => {
        const latest = current as Session
        const total = BigInt(latest.refundedMinor) + BigInt(amount)
        if (total > BigInt(latest.amountMinor))
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Refund exceeds the remaining payment amount",
          )
        const snapshot = await this.gateway.getPaymentStatus({
          providerPaymentId: latest.payId,
          ...(latest.refundedMinor !== "0"
            ? {
                reconciliation: {
                  capturedAmountMinor: latest.amountMinor,
                  refundedAmountMinor: latest.refundedMinor,
                },
              }
            : {}),
        })
        if (
          !["paid", "captured", "partially_refunded"].includes(snapshot.state)
        )
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Payment is not settled or has an unresolved refund",
          )
        await this.gateway.refundPayment({
          kind: "partial",
          providerPaymentId: latest.payId,
          amountMinor: amount,
          capturedAmountMinor: latest.amountMinor,
          alreadyRefundedAmountMinor: latest.refundedMinor,
          idempotencyKey: operation,
          correlationId: latest.sessionId,
        })
        return {
          result: { data: this.data(latest) },
          state: { ...latest, refundedMinor: total.toString() },
        }
      },
    )
  }
  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    // eAPI's browser return is not a server webhook. The storefront completes its
    // own cart through Medusa; authorizePayment actively verifies the bank state.
    return { action: "not_supported" }
  }
  async __shutdown() {
    await this.store.close?.()
  }
}
