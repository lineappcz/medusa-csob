import { CSOB_EAPI_1_9_ENDPOINTS, buildCsobMerchantData } from "../src/client"
import {
  FIXED_CSOB_DATE_TIME,
  FIXED_DATE,
  PAY_ID,
  QueueHttpClient,
  RecordingSignatureBoundary,
  initializeCommand,
  jsonResponse,
} from "./fixtures"
import { TestableCsobEapi19CustomerPaymentAdapter } from "./raw-csob-adapter.test-helper"

const createAdapter = ({
  responses,
  boundary = new RecordingSignatureBoundary(),
  environment = "sandbox" as const,
}: {
  responses: ConstructorParameters<typeof QueueHttpClient>[0]
  boundary?: RecordingSignatureBoundary
  environment?: "sandbox" | "production"
}) => {
  const httpClient = new QueueHttpClient(responses)
  const adapter = new TestableCsobEapi19CustomerPaymentAdapter({
    environment,
    merchantId: "M1MIPS0000",
    signer: boundary,
    verifier: boundary,
    httpClient,
    clock: () => FIXED_DATE,
  })

  return { adapter, boundary, httpClient }
}

describe("ČSOB eAPI 1.9 customer payment adapter", () => {
  it("initializes a hosted payment and returns a signed process URL", async () => {
    const { adapter, boundary, httpClient } = createAdapter({
      responses: [jsonResponse()],
    })
    const initialized =
      await adapter.initializePaymentOperationForTest(initializeCommand())
    const result = {
      ...initialized,
      redirectUrl: await adapter.createPaymentRedirectUrl(
        initialized.providerPaymentId,
      ),
    }

    expect(result).toMatchObject({
      provider: "csob",
      providerPaymentId: PAY_ID,
      state: "pending",
      providerStatusCode: "1",
      orderReference: "5547",
      operationContext: {
        idempotencyKey: "checkout.cart_01.revision_1",
        correlationId: "cart_01",
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(result.redirectUrl).toBe(
      `${CSOB_EAPI_1_9_ENDPOINTS.sandbox}/payment/process/M1MIPS0000/${encodeURIComponent(PAY_ID)}/${FIXED_CSOB_DATE_TIME}/c2ln`,
    )

    expect(httpClient.requests).toHaveLength(1)
    expect(httpClient.requests[0]).toMatchObject({
      url: `${CSOB_EAPI_1_9_ENDPOINTS.sandbox}/payment/init`,
      method: "POST",
      timeoutMs: 10_000,
    })
    const body = JSON.parse(httpClient.requests[0].body as string)
    expect(body).toMatchObject({
      merchantId: "M1MIPS0000",
      orderNo: "5547",
      dttm: FIXED_CSOB_DATE_TIME,
      payOperation: "payment",
      payMethod: "card",
      totalAmount: 123400,
      currency: "CZK",
      closePayment: true,
      returnMethod: "POST",
      customerId: "customer_01",
      language: "cs",
      ttlSec: 1800,
      signature: "c2ln",
    })
    expect(body.cart).toEqual([
      { name: "Tiskoviny", quantity: 1, amount: 120000 },
      { name: "Doprava", quantity: 1, amount: 3400, description: "DPD" },
    ])
    expect(body.merchantData).toBe(result.merchantData)
    expect(boundary.signedTexts).toEqual([
      expect.stringContaining(
        "M1MIPS0000|5547|20260831123456|payment|card|123400|CZK|true",
      ),
      `M1MIPS0000|${PAY_ID}|${FIXED_CSOB_DATE_TIME}`,
    ])
    expect(boundary.verifiedTexts[0].text).toBe(
      `${PAY_ID}|${FIXED_CSOB_DATE_TIME}|0|OK|1`,
    )
  })

  it("queries the production status endpoint and maps settled as paid", async () => {
    const { adapter, httpClient } = createAdapter({
      environment: "production",
      responses: [jsonResponse({ paymentStatus: 8, authCode: "F7A23E" })],
    })

    await expect(
      adapter.getPaymentStatus({ providerPaymentId: PAY_ID }),
    ).resolves.toMatchObject({
      state: "paid",
      authorizationCode: "F7A23E",
    })
    expect(httpClient.requests[0].url).toBe(
      `${CSOB_EAPI_1_9_ENDPOINTS.production}/payment/status/M1MIPS0000/${encodeURIComponent(PAY_ID)}/${FIXED_CSOB_DATE_TIME}/c2ln`,
    )
    expect(httpClient.requests[0].method).toBe("GET")
    expect(httpClient.requests[0].body).toBeUndefined()
  })

  it("validates a signed browser return and then actively fetches status", async () => {
    const { adapter, boundary, httpClient } = createAdapter({
      responses: [jsonResponse({ paymentStatus: 8, authCode: "F7A23E" })],
    })
    const merchantData = buildCsobMerchantData({
      idempotencyKey: "checkout.cart_01.revision_1",
      correlationId: "cart_01",
    })
    const returned = new URLSearchParams({
      payId: PAY_ID,
      dttm: FIXED_CSOB_DATE_TIME,
      resultCode: "0",
      resultMessage: "OK",
      paymentStatus: "7",
      authCode: "F7A23E",
      merchantData,
      signature: "c2ln",
    })

    await expect(
      adapter.verifyPaymentStatus({
        providerPaymentId: PAY_ID,
        returnPayload: returned,
        idempotencyKey: "checkout.cart_01.revision_1",
        correlationId: "cart_01",
      }),
    ).resolves.toMatchObject({ state: "paid", providerStatusCode: "8" })

    expect(httpClient.requests).toHaveLength(1)
    expect(httpClient.requests[0].url).toContain("/payment/status/")
    expect(boundary.verifiedTexts).toHaveLength(2)
    expect(boundary.verifiedTexts[0].text).toBe(
      `${PAY_ID}|${FIXED_CSOB_DATE_TIME}|0|OK|7|F7A23E|${merchantData}`,
    )
  })

  it("implements close, reverse, full refund and partial refund", async () => {
    const { adapter, httpClient } = createAdapter({
      responses: [
        jsonResponse({ paymentStatus: 7, authCode: "AUTH01" }),
        jsonResponse({ paymentStatus: 5 }),
        jsonResponse({ paymentStatus: 10, authCode: "AUTH01" }),
        jsonResponse({ paymentStatus: 10, authCode: "AUTH01" }),
      ],
    })

    await expect(
      adapter.capturePayment({
        providerPaymentId: PAY_ID,
        amountMinor: "10000",
        idempotencyKey: "capture.order_01.attempt_1",
        correlationId: "order_01",
      }),
    ).resolves.toMatchObject({ state: "captured" })
    await expect(
      adapter.cancelPayment({
        providerPaymentId: PAY_ID,
        idempotencyKey: "cancel.order_01.attempt_1",
        correlationId: "order_01",
      }),
    ).resolves.toMatchObject({ state: "cancelled" })
    await expect(
      adapter.refundPayment({
        kind: "full",
        providerPaymentId: PAY_ID,
        idempotencyKey: "refund.order_01.full_1",
        correlationId: "order_01",
      }),
    ).resolves.toMatchObject({ state: "refunded" })
    await expect(
      adapter.refundPayment({
        kind: "partial",
        providerPaymentId: PAY_ID,
        amountMinor: "2500",
        capturedAmountMinor: "10000",
        alreadyRefundedAmountMinor: "0",
        idempotencyKey: "refund.order_01.partial_1",
        correlationId: "order_01",
      }),
    ).resolves.toMatchObject({ state: "partially_refunded" })

    expect(httpClient.requests.map((request) => request.url)).toEqual([
      `${CSOB_EAPI_1_9_ENDPOINTS.sandbox}/payment/close`,
      `${CSOB_EAPI_1_9_ENDPOINTS.sandbox}/payment/reverse`,
      `${CSOB_EAPI_1_9_ENDPOINTS.sandbox}/payment/refund`,
      `${CSOB_EAPI_1_9_ENDPOINTS.sandbox}/payment/refund`,
    ])
    expect(
      httpClient.requests.map((request) => JSON.parse(request.body as string)),
    ).toEqual([
      expect.objectContaining({ totalAmount: 10000, signature: "c2ln" }),
      expect.not.objectContaining({ amount: expect.anything() }),
      expect.not.objectContaining({ amount: expect.anything() }),
      expect.objectContaining({ amount: 2500, signature: "c2ln" }),
    ])
  })

  it("produces the same logical fingerprint for an identical command", async () => {
    const first = createAdapter({ responses: [jsonResponse()] })
    const second = createAdapter({ responses: [jsonResponse()] })
    const command = initializeCommand({ orderReference: undefined })

    const firstResult =
      await first.adapter.initializePaymentOperationForTest(command)
    const secondResult =
      await second.adapter.initializePaymentOperationForTest(command)

    expect(secondResult.orderReference).toBe(firstResult.orderReference)
    expect(secondResult.merchantData).toBe(firstResult.merchantData)
    expect(secondResult.operationContext.requestFingerprint).toBe(
      firstResult.operationContext.requestFingerprint,
    )
  })
})
