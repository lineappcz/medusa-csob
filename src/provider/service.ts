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
  CsobAuthFingerprint,
  CsobLoanCustomer,
  CsobMallpayCustomer,
  CsobMallpayOrder,
  CsobMallpayOrderRef,
  CsobPurchaseCustomer,
  CsobPurchaseOrder,
  MallpayRefundCommand,
} from "../client"
import { CSOB_CHECKOUT_METHODS } from "../client"
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
  method: string
  processed?: boolean
  customerCode?: string
  payByLinkUrl?: string
  mallpayUrl?: string
  comparisonUrl?: string
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
      method: session.method,
      ...(session.customerCode ? { customer_code: session.customerCode } : {}),
      ...(session.payByLinkUrl
        ? { pay_by_link_url: session.payByLinkUrl }
        : {}),
      ...(session.mallpayUrl ? { mallpay_url: session.mallpayUrl } : {}),
      ...(session.comparisonUrl
        ? { comparison_url: session.comparisonUrl }
        : {}),
    }
  }

  private contextRecord(input: {
    context?: Record<string, unknown>
    data?: Record<string, unknown>
  }): Record<string, unknown> {
    return {
      ...(input.data ?? {}),
      ...(input.context ?? {}),
    }
  }

  private async initiateByMethod({
    method,
    command,
    context,
    amountMinor,
    currency,
    sessionId,
  }: {
    method: string
    command: InitializeCustomerPaymentCommand
    context: Record<string, unknown>
    amountMinor: string
    currency: string
    sessionId: string
  }) {
    const clientIp =
      typeof context.client_ip === "string" ? context.client_ip : undefined
    if (method === "oneclick" && context.create_template !== true) {
      const initialized = await this.gateway.initializeOneClickPayment({
        origPayId: required(context.orig_pay_id),
        idempotencyKey: sessionId,
        correlationId: sessionId,
        amount: { amountMinor, currencyCode: currency },
        clientIp,
        returnUrl: command.returnUrl,
        captureMode: command.captureMode,
        customer: command.customer,
        order: command.order,
        clientInitiated: context.client_initiated !== false,
        sdkUsed: context.sdk_used === true,
        language: command.language,
        returnMethod: command.returnMethod,
      })
      return { ...initialized, redirectUrl: "" }
    }
    if (method === "applepay" || method === "googlepay") {
      const wallet = {
        payload: required(context.payload),
        clientIp: required(clientIp),
        amount: { amountMinor, currencyCode: currency },
        returnUrl: command.returnUrl,
        captureMode: command.captureMode,
        idempotencyKey: sessionId,
        correlationId: sessionId,
        customer: command.customer,
        order: command.order,
        sdkUsed: context.sdk_used === true,
        language: command.language,
        returnMethod: command.returnMethod,
      }
      const initialized =
        method === "applepay"
          ? await this.gateway.initializeApplePay(wallet)
          : await this.gateway.initializeGooglePay(wallet)
      return { ...initialized, redirectUrl: "" }
    }
    if (method === "button") {
      const initialized = await this.gateway.initializePaymentButton({
        amount: { amountMinor, currencyCode: currency },
        clientIp: required(clientIp),
        returnUrl: command.returnUrl,
        idempotencyKey: sessionId,
        correlationId: sessionId,
        language: command.language,
        returnMethod: command.returnMethod,
      })
      return {
        ...initialized,
        redirectUrl: initialized.redirect?.url ?? "",
      }
    }
    if (method === "mallpay") {
      const initialized = await this.gateway.initializeMallpay({
        customer: context.mallpay_customer as CsobMallpayCustomer,
        order: context.mallpay_order as CsobMallpayOrder,
        agreeTC: context.agree_tc === true,
        clientIp: required(clientIp),
        returnUrl: command.returnUrl,
        idempotencyKey: sessionId,
        correlationId: sessionId,
        returnMethod: command.returnMethod,
      })
      return {
        ...initialized,
        redirectUrl: initialized.mallpayUrl ?? "",
      }
    }
    if (method === "loan") {
      const initialized = await this.gateway.initializeLoan({
        purchaseId: required(context.purchase_id),
        clientIp: required(clientIp),
        amount: { amountMinor, currencyCode: currency },
        returnUrl: command.returnUrl,
        idempotencyKey: sessionId,
        correlationId: sessionId,
        customer: context.loan_customer as CsobLoanCustomer | undefined,
        language: command.language,
        returnMethod: command.returnMethod,
      })
      return {
        ...initialized,
        redirectUrl: initialized.comparisonUrl ?? "",
      }
    }
    const initialized = await this.gateway.initialize(command)
    const redirectUrl =
      initialized.payByLinkUrl ??
      (await this.gateway.createPaymentRedirectUrl(
        initialized.providerPaymentId,
      ))
    return { ...initialized, redirectUrl }
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
    const context = this.contextRecord(input)
    const method = String(context.csob_method ?? context.method ?? "card")
    if (
      !CSOB_CHECKOUT_METHODS.includes(
        method as (typeof CSOB_CHECKOUT_METHODS)[number],
      )
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Unsupported ČSOB checkout method",
      )
    }
    const language =
      typeof context.language === "string" ? context.language : "cs"
    const customerId =
      typeof context.customer_id === "string"
        ? context.customer_id
        : typeof context.customerId === "string"
          ? context.customerId
          : undefined
    const command: InitializeCustomerPaymentCommand = {
      amount: { amountMinor, currencyCode: currency },
      lines: Array.isArray(context.lines)
        ? (context.lines as InitializeCustomerPaymentCommand["lines"])
        : [
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
      language,
      customerId,
      payOperation:
        method === "custom"
          ? "customPayment"
          : method === "oneclick" && context.create_template === true
            ? "oneclickPayment"
            : "payment",
      payMethod: context.pay_method === "card#LVP" ? "card#LVP" : "card",
      returnMethod: context.return_method === "GET" ? "GET" : "POST",
      customer: context.customer as CsobPurchaseCustomer | undefined,
      order: context.order as CsobPurchaseOrder | undefined,
      logoVersion:
        typeof context.logo_version === "number"
          ? context.logo_version
          : undefined,
      colorSchemeVersion:
        typeof context.color_scheme_version === "number"
          ? context.color_scheme_version
          : undefined,
      customExpiry:
        typeof context.custom_expiry === "string"
          ? context.custom_expiry
          : undefined,
    }
    return this.store.run(sessionId, "init", command, async () => {
      const initialized = await this.initiateByMethod({
        method,
        command,
        context,
        amountMinor,
        currency,
        sessionId,
      })
      const session: Session = {
        sessionId,
        payId: initialized.providerPaymentId,
        amountMinor,
        currency,
        refundedMinor: "0",
        redirectUrl: initialized.redirectUrl ?? "",
        method,
        customerCode: initialized.customerCode,
        payByLinkUrl: initialized.payByLinkUrl,
        mallpayUrl: initialized.mallpayUrl,
        comparisonUrl: initialized.comparisonUrl,
      }
      return {
        result: {
          id: session.payId,
          status: statusOf(initialized),
          data: {
            ...this.data(session),
            ...(initialized.actions ? { actions: initialized.actions } : {}),
          },
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
    return {
      status: statusOf(snapshot),
      data: {
        ...this.data(session),
        ...(snapshot.actions ? { actions: snapshot.actions } : {}),
      },
    }
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
    const context = this.contextRecord(input)
    if (
      session.method === "mallpay" &&
      typeof context.mallpay_event === "string"
    ) {
      return this.store.run(
        session.sessionId,
        `logistics:${context.mallpay_event}`,
        {
          event: context.mallpay_event,
          date: context.mallpay_date,
        },
        async (current) => {
          await this.gateway.updateMallpayLogistics({
            providerPaymentId: session.payId,
            date: required(context.mallpay_date),
            event: context.mallpay_event as string,
            fulfilled: context.mallpay_fulfilled as
              | CsobMallpayOrderRef
              | undefined,
            cancelled: context.mallpay_cancelled as
              | CsobMallpayOrderRef
              | undefined,
            deliveryTrackingNumber:
              typeof context.delivery_tracking_number === "string"
                ? context.delivery_tracking_number
                : undefined,
            idempotencyKey: `${session.sessionId}:logistics`,
            correlationId: session.sessionId,
          })
          const latest = current as Session
          return {
            result: await this.getPaymentStatus({ data: this.data(latest) }),
            state: latest,
          }
        },
      )
    }
    if (session.method === "loan" && typeof context.loan_event === "string") {
      return this.store.run(
        session.sessionId,
        `logistics:${context.loan_event}`,
        { event: context.loan_event },
        async (current) => {
          await this.gateway.updateLoanLogistics({
            providerPaymentId: session.payId,
            event: context.loan_event as string,
            idempotencyKey: `${session.sessionId}:logistics`,
            correlationId: session.sessionId,
          })
          const latest = current as Session
          return {
            result: await this.getPaymentStatus({ data: this.data(latest) }),
            state: latest,
          }
        },
      )
    }
    const fingerprint = context.fingerprint as CsobAuthFingerprint | undefined
    if (
      fingerprint &&
      ["oneclick", "applepay", "googlepay"].includes(session.method) &&
      !session.processed
    ) {
      return this.store.run(
        session.sessionId,
        "process",
        { fingerprint },
        async (current) => {
          const latest = current as Session
          if (latest.method === "oneclick") {
            await this.gateway.processOneClickPayment({
              providerPaymentId: latest.payId,
              fingerprint,
              idempotencyKey: `${latest.sessionId}:process`,
              correlationId: latest.sessionId,
            })
          } else if (latest.method === "applepay") {
            await this.gateway.processApplePay({
              providerPaymentId: latest.payId,
              fingerprint,
              idempotencyKey: `${latest.sessionId}:process`,
              correlationId: latest.sessionId,
            })
          } else {
            await this.gateway.processGooglePay({
              providerPaymentId: latest.payId,
              fingerprint,
              idempotencyKey: `${latest.sessionId}:process`,
              correlationId: latest.sessionId,
            })
          }
          const processed = { ...latest, processed: true }
          return {
            result: await this.getPaymentStatus({ data: this.data(processed) }),
            state: processed,
          }
        },
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
          const reason =
            typeof input.data?.reason === "string"
              ? input.data.reason
              : "aborted"
          if (session.method === "mallpay") {
            await this.gateway.cancelMallpay({
              providerPaymentId: session.payId,
              reason,
              idempotencyKey: `${session.sessionId}:cancel`,
              correlationId: session.sessionId,
            })
          } else if (session.method === "loan") {
            await this.gateway.cancelLoan({
              providerPaymentId: session.payId,
              reason,
              idempotencyKey: `${session.sessionId}:cancel`,
              correlationId: session.sessionId,
            })
          } else {
            await this.gateway.cancelPayment({
              providerPaymentId: session.payId,
              idempotencyKey: `${session.sessionId}:cancel`,
              correlationId: session.sessionId,
            })
          }
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
        const refundContext = this.contextRecord(input)
        if (latest.method === "mallpay") {
          await this.gateway.refundMallpay({
            providerPaymentId: latest.payId,
            amountMinor: amount,
            refundedItems: refundContext.refunded_items as
              | MallpayRefundCommand["refundedItems"]
              | undefined,
            idempotencyKey: operation,
            correlationId: latest.sessionId,
          })
        } else if (latest.method === "loan") {
          await this.gateway.refundLoan({
            providerPaymentId: latest.payId,
            amountMinor: amount,
            reason:
              typeof refundContext.reason === "string"
                ? refundContext.reason
                : undefined,
            date:
              typeof refundContext.date === "string"
                ? refundContext.date
                : undefined,
            idempotencyKey: operation,
            correlationId: latest.sessionId,
          })
        } else {
          await this.gateway.refundPayment({
            kind: "partial",
            providerPaymentId: latest.payId,
            amountMinor: amount,
            capturedAmountMinor: latest.amountMinor,
            alreadyRefundedAmountMinor: latest.refundedMinor,
            idempotencyKey: operation,
            correlationId: latest.sessionId,
          })
        }
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
