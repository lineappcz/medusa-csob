import { generateKeyPairSync } from "node:crypto"

import {
  NodeRsaSha256CsobSignatureService,
  buildCsobPaymentInitSignatureText,
  buildCsobPaymentOperationSignatureText,
  buildCsobPaymentResponseSignatureText,
  buildCsobReturnSignatureText,
  formatCsobDateTime,
  isCanonicalBase64,
} from "../src/client"

describe("ČSOB eAPI 1.9 signing boundary", () => {
  it("formats request timestamps in Europe/Prague across DST", () => {
    expect(formatCsobDateTime(new Date("2026-01-15T12:00:00.000Z"))).toBe(
      "20260115130000",
    )
    expect(formatCsobDateTime(new Date("2026-07-15T12:00:00.000Z"))).toBe(
      "20260715140000",
    )
  })

  it("builds the official payment/init field order without placeholders", () => {
    expect(
      buildCsobPaymentInitSignatureText({
        merchantId: "M1MIPS0000",
        orderNo: "5547",
        dttm: "20220125131559",
        payOperation: "payment",
        payMethod: "card",
        totalAmount: 123400,
        currency: "CZK",
        closePayment: true,
        returnUrl: "https://shop.example.com/return",
        returnMethod: "POST",
        cart: [
          { name: "Wireless headphones", quantity: 1, amount: 123400 },
          { name: "Shipping", quantity: 1, amount: 0, description: "DPL" },
        ],
        merchantData: "some-base64-encoded-merchant-data",
        language: "cs",
      }),
    ).toBe(
      "M1MIPS0000|5547|20220125131559|payment|card|123400|CZK|true|https://shop.example.com/return|POST|Wireless headphones|1|123400|Shipping|1|0|DPL|some-base64-encoded-merchant-data|cs",
    )
  })

  it("preserves false and zero while omitting only undefined values", () => {
    expect(
      buildCsobPaymentInitSignatureText({
        merchantId: "M1MIPS0000",
        orderNo: "1",
        dttm: "20220125131559",
        payOperation: "payment",
        payMethod: "card",
        totalAmount: 1,
        currency: "CZK",
        closePayment: false,
        returnUrl: "https://shop.example.com/return",
        returnMethod: "POST",
        cart: [{ name: "Order", quantity: 1, amount: 0 }],
        merchantData: "e30=",
        language: "cs",
      }),
    ).toContain("|false|")
  })

  it("builds management, API response and browser return signatures", () => {
    expect(
      buildCsobPaymentOperationSignatureText({
        merchantId: "M1MIPS0000",
        payId: "7624c5e60252@HA",
        dttm: "20220125131615",
        amount: 1000,
      }),
    ).toBe("M1MIPS0000|7624c5e60252@HA|20220125131615|1000")

    const response = {
      payId: "7624c5e60252@HA",
      dttm: "20220125131821",
      resultCode: 0,
      resultMessage: "OK",
      paymentStatus: 7,
      authCode: "qwFDF32",
      merchantData: "base64-encoded-merchant-data",
      statusDetail: "detail",
      signature: "c2ln",
    }
    expect(buildCsobPaymentResponseSignatureText(response, "payment")).toBe(
      "7624c5e60252@HA|20220125131821|0|OK|7|qwFDF32|detail",
    )
    expect(buildCsobReturnSignatureText(response)).toBe(
      "7624c5e60252@HA|20220125131821|0|OK|7|qwFDF32|base64-encoded-merchant-data|detail",
    )
  })

  it("signs and verifies RSA-SHA256 with injected KeyObjects", async () => {
    const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const gatewayKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const merchantService = new NodeRsaSha256CsobSignatureService(
      merchantKeys.privateKey,
      merchantKeys.publicKey,
    )
    const gatewayVerifier = new NodeRsaSha256CsobSignatureService(
      gatewayKeys.privateKey,
      gatewayKeys.publicKey,
    )
    const text = "M1MIPS0000|20220125131615"
    const signature = await merchantService.sign(text)

    expect(isCanonicalBase64(signature)).toBe(true)
    expect(await merchantService.verify(text, signature)).toBe(true)
    expect(await gatewayVerifier.verify(text, signature)).toBe(false)
    expect(await merchantService.verify(`${text}|tampered`, signature)).toBe(
      false,
    )
    expect(await merchantService.verify(text, "not-base64")).toBe(false)
  })
})
