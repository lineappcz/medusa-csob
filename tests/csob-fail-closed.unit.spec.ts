import {
  CSOB_EAPI_1_9_ENDPOINTS,
  CustomerPaymentIntegrationError,
  buildCsobMerchantData,
} from "../src/client"
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

const configuredAdapter = ({
  responses,
  boundary = new RecordingSignatureBoundary(),
}: {
  responses: ConstructorParameters<typeof QueueHttpClient>[0]
  boundary?: RecordingSignatureBoundary
}) => {
  const httpClient = new QueueHttpClient(responses)
  return {
    adapter: new TestableCsobEapi19CustomerPaymentAdapter({
      environment: "sandbox",
      merchantId: "M1MIPS0000",
      signer: boundary,
      verifier: boundary,
      httpClient,
      clock: () => FIXED_DATE,
    }),
    httpClient,
  }
}

describe("ČSOB eAPI 1.9 fail-closed behavior", () => {
  it("refuses an unspecified or custom environment", () => {
    const boundary = new RecordingSignatureBoundary()
    expect(
      () =>
        new TestableCsobEapi19CustomerPaymentAdapter({
          environment: "staging" as "sandbox",
          merchantId: "M1MIPS0000",
          signer: boundary,
          verifier: boundary,
        }),
    ).toThrow(
      expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
        code: "CSOB_ENVIRONMENT_INVALID",
        outcome: "CONFIGURATION",
      }),
    )
  })

  it.each([
    [
      "unexpected content type",
      {
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<html>not-json</html>",
      },
      "CSOB_RESPONSE_CONTENT_TYPE_INVALID",
    ],
    [
      "malformed JSON",
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: "{",
      },
      "CSOB_RESPONSE_INVALID",
    ],
    [
      "missing signature",
      jsonResponse({ signature: undefined }),
      "CSOB_RESPONSE_INVALID",
    ],
    [
      "unknown state",
      jsonResponse({ paymentStatus: 11 }),
      "CSOB_PAYMENT_STATUS_UNKNOWN",
    ],
    [
      "malformed response actions",
      jsonResponse({ actions: "not-an-object" }),
      "CSOB_RESPONSE_ACTIONS_INVALID",
    ],
    [
      "mismatched payment ID",
      jsonResponse({ payId: "aa41e84b7e33@HA" }),
      "CSOB_RESPONSE_PAY_ID_MISMATCH",
    ],
  ])("rejects %s", async (_label, response, code) => {
    const { adapter } = configuredAdapter({ responses: [response] })
    await expect(
      adapter.getPaymentStatus({ providerPaymentId: PAY_ID }),
    ).rejects.toMatchObject({ code })
  })

  it("rejects a cryptographically invalid response before mapping it", async () => {
    const { adapter } = configuredAdapter({
      responses: [jsonResponse({ paymentStatus: 8 })],
      boundary: new RecordingSignatureBoundary(false),
    })

    await expect(
      adapter.getPaymentStatus({ providerPaymentId: PAY_ID }),
    ).rejects.toMatchObject({
      code: "CSOB_RESPONSE_SIGNATURE_INVALID",
      outcome: "UNKNOWN",
    })
  })

  it("rejects a signed provider error without exposing its message", async () => {
    const { adapter } = configuredAdapter({
      responses: [
        jsonResponse({
          resultCode: 110,
          resultMessage: "Internal provider diagnostic",
          paymentStatus: 6,
        }),
      ],
    })

    await expect(
      adapter.getPaymentStatus({ providerPaymentId: PAY_ID }),
    ).rejects.toMatchObject({
      code: "CSOB_OPERATION_REJECTED",
      message: "ČSOB rejected the payment operation.",
      providerResultCode: "110",
    })
  })

  it("accepts case-insensitive HTTP response header names", async () => {
    const response = jsonResponse({ paymentStatus: 8 })
    response.headers = { "Content-Type": "application/json" }
    const { adapter } = configuredAdapter({ responses: [response] })

    await expect(
      adapter.getPaymentStatus({ providerPaymentId: PAY_ID }),
    ).resolves.toMatchObject({ state: "paid" })
  })

  it("classifies a read outage as retryable and a write outage as unknown", async () => {
    const unavailable = {
      status: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultCode: 500, resultMessage: "Unavailable" }),
    }
    const read = configuredAdapter({ responses: [unavailable] })
    await expect(
      read.adapter.getPaymentStatus({ providerPaymentId: PAY_ID }),
    ).rejects.toMatchObject({
      code: "CSOB_TEMPORARILY_UNAVAILABLE",
      outcome: "UNKNOWN",
      retryable: true,
      httpStatus: 503,
    })

    const write = configuredAdapter({ responses: [unavailable] })
    await expect(
      write.adapter.capturePayment({
        providerPaymentId: PAY_ID,
        idempotencyKey: "capture.order_01.attempt_1",
        correlationId: "order_01",
      }),
    ).rejects.toMatchObject({
      code: "CSOB_TEMPORARILY_UNAVAILABLE",
      outcome: "UNKNOWN",
      retryable: false,
    })
  })

  it("does not retry a mutating request after a network failure", async () => {
    const { adapter, httpClient } = configuredAdapter({
      responses: [new Error("socket closed")],
    })

    await expect(
      adapter.refundPayment({
        kind: "full",
        providerPaymentId: PAY_ID,
        idempotencyKey: "refund.order_01.attempt_1",
        correlationId: "order_01",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOMER_PAYMENT_OUTCOME_UNKNOWN",
      outcome: "UNKNOWN",
      retryable: false,
    })
    expect(httpClient.requests).toHaveLength(1)
  })

  it("rejects invalid totals and unsafe JSON integers before HTTP", async () => {
    const mismatch = configuredAdapter({ responses: [] })
    await expect(
      mismatch.adapter.initializePaymentOperationForTest(
        initializeCommand({
          amount: { amountMinor: "123401", currencyCode: "CZK" },
        }),
      ),
    ).rejects.toMatchObject({ code: "CSOB_CART_TOTAL_MISMATCH" })
    expect(mismatch.httpClient.requests).toHaveLength(0)

    const unsafe = configuredAdapter({ responses: [] })
    await expect(
      unsafe.adapter.initializePaymentOperationForTest(
        initializeCommand({
          amount: {
            amountMinor: "9007199254740993",
            currencyCode: "CZK",
          },
          lines: [
            {
              name: "Tiskoviny",
              quantity: 1,
              amountMinor: "9007199254740993",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "CUSTOMER_PAYMENT_AMOUNT_UNSAFE" })
    expect(unsafe.httpClient.requests).toHaveLength(0)
  })

  it("rejects over-refunds before HTTP", async () => {
    const { adapter, httpClient } = configuredAdapter({ responses: [] })
    await expect(
      adapter.refundPayment({
        kind: "partial",
        providerPaymentId: PAY_ID,
        amountMinor: "8000",
        capturedAmountMinor: "10000",
        alreadyRefundedAmountMinor: "2000",
        idempotencyKey: "refund.order_01.partial_2",
        correlationId: "order_01",
      }),
    ).rejects.toMatchObject({ code: "CSOB_PARTIAL_REFUND_INVALID" })
    expect(httpClient.requests).toHaveLength(0)
  })

  it("never performs an active query for an invalid browser signature", async () => {
    const { adapter, httpClient } = configuredAdapter({
      responses: [jsonResponse({ paymentStatus: 8 })],
      boundary: new RecordingSignatureBoundary(false),
    })
    const merchantData = buildCsobMerchantData({
      idempotencyKey: "checkout.cart_01.revision_1",
      correlationId: "cart_01",
    })

    await expect(
      adapter.verifyPaymentStatus({
        providerPaymentId: PAY_ID,
        idempotencyKey: "checkout.cart_01.revision_1",
        correlationId: "cart_01",
        returnPayload: {
          payId: PAY_ID,
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: "0",
          resultMessage: "OK",
          paymentStatus: "8",
          merchantData,
          signature: "c2ln",
        },
      }),
    ).rejects.toMatchObject({ code: "CSOB_RETURN_SIGNATURE_INVALID" })
    expect(httpClient.requests).toHaveLength(0)
  })

  it("never performs an active query for mismatched return correlation", async () => {
    const { adapter, httpClient } = configuredAdapter({
      responses: [jsonResponse({ paymentStatus: 8 })],
    })
    const merchantData = buildCsobMerchantData({
      idempotencyKey: "checkout.cart_02.revision_1",
      correlationId: "cart_02",
    })

    await expect(
      adapter.verifyPaymentStatus({
        providerPaymentId: PAY_ID,
        idempotencyKey: "checkout.cart_01.revision_1",
        correlationId: "cart_01",
        returnPayload: {
          payId: PAY_ID,
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: "0",
          resultMessage: "OK",
          paymentStatus: "8",
          merchantData,
          signature: "c2ln",
        },
      }),
    ).rejects.toMatchObject({ code: "CSOB_RETURN_CORRELATION_INVALID" })
    expect(httpClient.requests).toHaveLength(0)
  })

  it("uses only the fixed official sandbox endpoint", () => {
    expect(CSOB_EAPI_1_9_ENDPOINTS.sandbox).toBe(
      "https://iapi.iplatebnibrana.csob.cz/api/v1.9",
    )
  })
})
