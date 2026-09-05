import { createSign, createVerify, type KeyObject } from "node:crypto"

import {
  flattenCsobAuthFingerprint,
  flattenCsobPaymentActions,
  flattenCsobRedirect,
  type CsobAuthFingerprint,
  type CsobPaymentActions,
  type CsobRedirect,
} from "./csob-auth-data"
import {
  flattenCsobLoanCustomer,
  flattenCsobMallpayCustomer,
  flattenCsobMallpayOrder,
  flattenCsobMallpayOrderRef,
  type CsobLoanCustomer,
  type CsobMallpayCustomer,
  type CsobMallpayItem,
  type CsobMallpayOrder,
  type CsobMallpayOrderRef,
} from "./csob-alt-payments"
import {
  flattenCsobPurchaseCustomer,
  flattenCsobPurchaseOrder,
  type CsobPurchaseCustomer,
  type CsobPurchaseOrder,
} from "./csob-purchase-data"
import { customerPaymentInvariant } from "./errors"

export interface CsobRequestSigner {
  sign(textToSign: string): Promise<string>
}

export interface CsobResponseVerifier {
  verify(textToSign: string, signature: string): Promise<boolean>
}

export type CsobSignatureService = CsobRequestSigner & CsobResponseVerifier

export type CsobSigningValue = string | number | boolean | undefined

export type CsobCartItemWire = {
  name: string
  quantity: number
  amount: number
  description?: string
}

export type CsobPaymentInitWire = {
  merchantId: string
  orderNo: string
  dttm: string
  payOperation: "payment" | "oneclickPayment" | "customPayment"
  payMethod: "card" | "card#LVP"
  totalAmount: number
  currency: string
  closePayment: boolean
  returnUrl: string
  returnMethod: "POST" | "GET"
  cart: CsobCartItemWire[]
  customer?: CsobPurchaseCustomer
  order?: CsobPurchaseOrder
  merchantData: string
  customerId?: string
  language: string
  ttlSec?: number
  logoVersion?: number
  colorSchemeVersion?: number
  customExpiry?: string
}

export type CsobPaymentResponseWire = {
  payId: string
  dttm: string
  resultCode: number
  resultMessage: string
  paymentStatus: number
  authCode?: string
  customerCode?: string
  merchantData?: string
  statusDetail?: string
  actions?: CsobPaymentActions
  redirect?: CsobRedirect
  mallpayUrl?: string
  comparisonUrl?: string
  origPayId?: string
  customerId?: string
  initParams?: Record<string, unknown>
  extensions?: Array<Record<string, unknown>>
  signature: string
}

export type CsobApplePayInitWire = {
  merchantId: string
  orderNo: string
  dttm: string
  clientIp: string
  totalAmount: number
  currency: string
  closePayment?: boolean
  payload: string
  returnUrl: string
  returnMethod: "POST" | "GET"
  customer?: CsobPurchaseCustomer
  order?: CsobPurchaseOrder
  sdkUsed?: boolean
  merchantData?: string
  language?: string
  ttlSec?: number
}

export type CsobGooglePayInitWire = CsobApplePayInitWire

export type CsobOneClickInitWire = {
  merchantId: string
  origPayId: string
  orderNo: string
  dttm: string
  payMethod?: "card" | "card#LVP"
  clientIp?: string
  totalAmount?: number
  currency?: string
  closePayment?: boolean
  returnUrl?: string
  returnMethod?: "POST" | "GET"
  customer?: CsobPurchaseCustomer
  order?: CsobPurchaseOrder
  clientInitiated?: boolean
  sdkUsed?: boolean
  merchantData?: string
  language?: string
  ttlSec?: number
}

export type CsobButtonInitWire = {
  merchantId: string
  orderNo: string
  dttm: string
  clientIp: string
  totalAmount: number
  currency: string
  returnUrl: string
  returnMethod: "POST" | "GET"
  brand?: "csob"
  merchantData?: string
  language?: string
}

export type CsobMallpayInitWire = {
  merchantId: string
  orderNo: string
  customer: CsobMallpayCustomer
  order: CsobMallpayOrder
  agreeTC: boolean
  dttm: string
  clientIp: string
  returnUrl: string
  returnMethod: "POST" | "GET"
  merchantData?: string
  ttlSec?: number
}

export type CsobLoanInitWire = {
  merchantId: string
  orderNo: string
  purchaseId: string
  dttm: string
  clientIp: string
  totalAmount: number
  currency: string
  returnUrl: string
  returnMethod: "POST" | "GET"
  customer?: CsobLoanCustomer
  merchantData?: string
  language?: string
}

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export const isCanonicalBase64 = (value: string): boolean =>
  value.length > 0 &&
  value.length % 4 === 0 &&
  CANONICAL_BASE64_PATTERN.test(value)

const serializeCsobSigningValue = (
  value: Exclude<CsobSigningValue, undefined>,
): string => {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

export const buildCsobSignatureText = (values: CsobSigningValue[]): string =>
  values
    .filter(
      (value): value is Exclude<CsobSigningValue, undefined> =>
        value !== undefined,
    )
    .map(serializeCsobSigningValue)
    .join("|")

export const buildCsobPaymentInitSignatureText = (
  request: CsobPaymentInitWire,
): string =>
  buildCsobSignatureText([
    request.merchantId,
    request.orderNo,
    request.dttm,
    request.payOperation,
    request.payMethod,
    request.totalAmount,
    request.currency,
    request.closePayment,
    request.returnUrl,
    request.returnMethod,
    ...request.cart.flatMap((item) => [
      item.name,
      item.quantity,
      item.amount,
      item.description,
    ]),
    ...flattenCsobPurchaseCustomer(request.customer),
    ...flattenCsobPurchaseOrder(request.order),
    request.merchantData,
    request.customerId,
    request.language,
    request.ttlSec,
    request.logoVersion,
    request.colorSchemeVersion,
    request.customExpiry,
  ])

export const buildCsobOneClickInitSignatureText = (
  request: CsobOneClickInitWire,
): string =>
  buildCsobSignatureText([
    request.merchantId,
    request.origPayId,
    request.orderNo,
    request.dttm,
    request.payMethod,
    request.clientIp,
    request.totalAmount,
    request.currency,
    request.closePayment,
    request.returnUrl,
    request.returnMethod,
    ...flattenCsobPurchaseCustomer(request.customer),
    ...flattenCsobPurchaseOrder(request.order),
    request.clientInitiated,
    request.sdkUsed,
    request.merchantData,
    request.language,
    request.ttlSec,
  ])

export const buildCsobWalletInitSignatureText = (
  request: CsobApplePayInitWire,
): string =>
  buildCsobSignatureText([
    request.merchantId,
    request.orderNo,
    request.dttm,
    request.clientIp,
    request.totalAmount,
    request.currency,
    request.closePayment,
    request.payload,
    request.returnUrl,
    request.returnMethod,
    ...flattenCsobPurchaseCustomer(request.customer),
    ...flattenCsobPurchaseOrder(request.order),
    request.sdkUsed,
    request.merchantData,
    request.language,
    request.ttlSec,
  ])

export const buildCsobButtonInitSignatureText = (
  request: CsobButtonInitWire,
): string =>
  buildCsobSignatureText([
    request.merchantId,
    request.orderNo,
    request.dttm,
    request.clientIp,
    request.totalAmount,
    request.currency,
    request.returnUrl,
    request.returnMethod,
    request.brand,
    request.merchantData,
    request.language,
  ])

export const buildCsobMallpayInitSignatureText = (
  request: CsobMallpayInitWire,
): string =>
  buildCsobSignatureText([
    request.merchantId,
    request.orderNo,
    ...flattenCsobMallpayCustomer(request.customer),
    ...flattenCsobMallpayOrder(request.order),
    request.agreeTC,
    request.dttm,
    request.clientIp,
    request.returnUrl,
    request.returnMethod,
    request.merchantData,
    request.ttlSec,
  ])

export const buildCsobLoanInitSignatureText = (
  request: CsobLoanInitWire,
): string =>
  buildCsobSignatureText([
    request.merchantId,
    request.orderNo,
    request.purchaseId,
    request.dttm,
    request.clientIp,
    request.totalAmount,
    request.currency,
    request.returnUrl,
    request.returnMethod,
    ...flattenCsobLoanCustomer(request.customer),
    request.merchantData,
    request.language,
  ])

export const buildCsobProcessSignatureText = ({
  merchantId,
  payId,
  dttm,
  fingerprint,
}: {
  merchantId: string
  payId: string
  dttm: string
  fingerprint?: CsobAuthFingerprint
}): string =>
  buildCsobSignatureText([
    merchantId,
    payId,
    dttm,
    ...flattenCsobAuthFingerprint(fingerprint),
  ])

export const buildCsobEchoSignatureText = ({
  merchantId,
  dttm,
  customerId,
  origPayId,
}: {
  merchantId: string
  dttm: string
  customerId?: string
  origPayId?: string
}): string => buildCsobSignatureText([merchantId, origPayId, customerId, dttm])

export const buildCsobMallpayLogisticsSignatureText = ({
  merchantId,
  payId,
  event,
  date,
  fulfilled,
  cancelled,
  deliveryTrackingNumber,
  dttm,
}: {
  merchantId: string
  payId: string
  event?: string
  date: string
  fulfilled?: CsobMallpayOrderRef
  cancelled?: CsobMallpayOrderRef
  deliveryTrackingNumber?: string
  dttm: string
}): string =>
  buildCsobSignatureText([
    merchantId,
    payId,
    event,
    date,
    ...flattenCsobMallpayOrderRef(fulfilled),
    ...flattenCsobMallpayOrderRef(cancelled),
    deliveryTrackingNumber,
    dttm,
  ])

export const buildCsobMallpayRefundSignatureText = ({
  merchantId,
  payId,
  dttm,
  amount,
  refundedItems,
}: {
  merchantId: string
  payId: string
  dttm: string
  amount?: number
  refundedItems?: Array<
    Pick<CsobMallpayItem, "code" | "ean" | "name" | "type" | "quantity">
  >
}): string =>
  buildCsobSignatureText([
    merchantId,
    payId,
    dttm,
    amount,
    ...(refundedItems ?? []).flatMap((item) => [
      item.code,
      item.ean,
      item.name,
      item.type,
      item.quantity,
    ]),
  ])

export const buildCsobReasonedOperationSignatureText = ({
  merchantId,
  payId,
  reason,
  dttm,
  event,
}: {
  merchantId: string
  payId: string
  dttm: string
  reason?: string
  event?: string
}): string => buildCsobSignatureText([merchantId, payId, reason ?? event, dttm])

export const buildCsobLoanRefundSignatureText = ({
  merchantId,
  payId,
  dttm,
  amount,
  reason,
  date,
}: {
  merchantId: string
  payId: string
  dttm: string
  amount?: number
  reason?: string
  date?: string
}): string =>
  buildCsobSignatureText([merchantId, payId, dttm, amount, reason, date])

export const buildCsobPaymentOperationSignatureText = ({
  merchantId,
  payId,
  dttm,
  amount,
}: {
  merchantId: string
  payId: string
  dttm: string
  amount?: number
}): string => buildCsobSignatureText([merchantId, payId, dttm, amount])

export const buildCsobPaymentResponseSignatureText = (
  response: CsobPaymentResponseWire,
  responseType:
    | "init"
    | "payment"
    | "process"
    | "echo"
    | "echoCustomer"
    | "oneclickEcho"
    | "applepayEcho"
    | "googlepayEcho"
    | "button"
    | "mallpayInit"
    | "loanInit",
): string => {
  if (responseType === "echo") {
    return buildCsobSignatureText([
      response.dttm,
      response.resultCode,
      response.resultMessage,
      ...flattenEchoInitParams(response.initParams, "applepay"),
    ])
  }
  if (responseType === "applepayEcho") {
    return buildCsobSignatureText([
      response.dttm,
      response.resultCode,
      response.resultMessage,
      ...flattenEchoInitParams(response.initParams, "applepay"),
    ])
  }
  if (responseType === "googlepayEcho") {
    return buildCsobSignatureText([
      response.dttm,
      response.resultCode,
      response.resultMessage,
      ...flattenEchoInitParams(response.initParams, "googlepay"),
    ])
  }
  if (responseType === "echoCustomer") {
    return buildCsobSignatureText([
      response.customerId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
    ])
  }
  if (responseType === "oneclickEcho") {
    return buildCsobSignatureText([
      response.origPayId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
    ])
  }
  if (responseType === "button") {
    return buildCsobSignatureText([
      response.payId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
      response.paymentStatus,
      ...flattenCsobRedirect(response.redirect),
    ])
  }
  if (responseType === "mallpayInit") {
    return buildCsobSignatureText([
      response.payId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
      response.paymentStatus,
      response.mallpayUrl,
    ])
  }
  if (responseType === "loanInit") {
    return buildCsobSignatureText([
      response.payId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
      response.paymentStatus,
      response.comparisonUrl,
    ])
  }
  if (responseType === "process") {
    return buildCsobSignatureText([
      response.payId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
      response.paymentStatus,
      response.statusDetail,
      ...flattenCsobPaymentActions(response.actions),
    ])
  }

  return buildCsobSignatureText(
    [
      response.payId,
      response.dttm,
      response.resultCode,
      response.resultMessage,
      response.paymentStatus,
      response.authCode,
      responseType === "init" ? response.customerCode : undefined,
      response.statusDetail,
      responseType === "payment"
        ? flattenCsobPaymentActions(response.actions)
        : undefined,
    ].flat(),
  )
}

const flattenEchoInitParams = (
  initParams: Record<string, unknown> | undefined,
  kind: "applepay" | "googlepay",
): CsobSigningValue[] => {
  if (!initParams) {
    return []
  }
  if (kind === "applepay") {
    const networks = Array.isArray(initParams.supportedNetworks)
      ? initParams.supportedNetworks
      : []
    const capabilities = Array.isArray(initParams.merchantCapabilities)
      ? initParams.merchantCapabilities
      : []
    return [
      initParams.countryCode as CsobSigningValue,
      ...networks.filter((value): value is string => typeof value === "string"),
      ...capabilities.filter(
        (value): value is string => typeof value === "string",
      ),
    ]
  }
  const networks = Array.isArray(initParams.allowedCardNetworks)
    ? initParams.allowedCardNetworks
    : []
  const methods = Array.isArray(initParams.allowedCardAuthMethods)
    ? initParams.allowedCardAuthMethods
    : []
  return [
    initParams.apiVersion as CsobSigningValue,
    initParams.apiVersionMinor as CsobSigningValue,
    initParams.paymentMethodType as CsobSigningValue,
    ...networks.filter((value): value is string => typeof value === "string"),
    ...methods.filter((value): value is string => typeof value === "string"),
    initParams.assuranceDetailsRequired as CsobSigningValue,
    initParams.billingAddressRequired as CsobSigningValue,
    initParams.billingAddressParametersFormat as CsobSigningValue,
    initParams.tokenizationSpecificationType as CsobSigningValue,
    initParams.gateway as CsobSigningValue,
    initParams.gatewayMerchantId as CsobSigningValue,
    initParams.googlepayMerchantId as CsobSigningValue,
    initParams.merchantName as CsobSigningValue,
    initParams.environment as CsobSigningValue,
    initParams.totalPriceStatus as CsobSigningValue,
    initParams.countryCode as CsobSigningValue,
  ]
}

export const buildCsobReturnSignatureText = (
  response: CsobPaymentResponseWire,
): string =>
  buildCsobSignatureText([
    response.payId,
    response.dttm,
    response.resultCode,
    response.resultMessage,
    response.paymentStatus,
    response.authCode,
    response.merchantData,
    response.statusDetail,
  ])

export class NodeRsaSha256CsobSignatureService implements CsobSignatureService {
  constructor(
    private readonly merchantPrivateKey: KeyObject,
    private readonly gatewayPublicKey: KeyObject,
  ) {
    customerPaymentInvariant(
      merchantPrivateKey.type === "private" &&
        merchantPrivateKey.asymmetricKeyType === "rsa",
      "CSOB_MERCHANT_KEY_INVALID",
      "ČSOB merchant signing key must be an RSA private KeyObject.",
      "CONFIGURATION",
    )
    customerPaymentInvariant(
      gatewayPublicKey.type === "public" &&
        gatewayPublicKey.asymmetricKeyType === "rsa",
      "CSOB_GATEWAY_KEY_INVALID",
      "ČSOB gateway verification key must be an RSA public KeyObject.",
      "CONFIGURATION",
    )
  }

  async sign(textToSign: string): Promise<string> {
    const signer = createSign("RSA-SHA256")
    signer.update(textToSign, "utf8")
    signer.end()
    return signer.sign(this.merchantPrivateKey).toString("base64")
  }

  async verify(textToSign: string, signature: string): Promise<boolean> {
    if (!isCanonicalBase64(signature)) {
      return false
    }

    const verifier = createVerify("RSA-SHA256")
    verifier.update(textToSign, "utf8")
    verifier.end()
    return verifier.verify(
      this.gatewayPublicKey,
      Buffer.from(signature, "base64"),
    )
  }
}
