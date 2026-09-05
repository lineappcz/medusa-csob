import { createSign, createVerify, type KeyObject } from "node:crypto"

import { customerPaymentInvariant } from "./errors"

export interface CsobRequestSigner {
  sign(textToSign: string): Promise<string>
}

export interface CsobResponseVerifier {
  verify(textToSign: string, signature: string): Promise<boolean>
}

export type CsobSignatureService = CsobRequestSigner & CsobResponseVerifier

type CsobSigningValue = string | number | boolean | undefined

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
  payOperation: "payment"
  payMethod: "card"
  totalAmount: number
  currency: string
  closePayment: boolean
  returnUrl: string
  returnMethod: "POST"
  cart: CsobCartItemWire[]
  merchantData: string
  customerId?: string
  language: string
  ttlSec?: number
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
  signature: string
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
    request.merchantData,
    request.customerId,
    request.language,
    request.ttlSec,
  ])

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
  responseType: "init" | "payment",
): string =>
  buildCsobSignatureText([
    response.payId,
    response.dttm,
    response.resultCode,
    response.resultMessage,
    response.paymentStatus,
    response.authCode,
    responseType === "init" ? response.customerCode : undefined,
    response.statusDetail,
  ])

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
