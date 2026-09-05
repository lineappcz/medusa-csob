import {
  CSOB_CUSTOM_PAYMENT_URLS,
  createCsobEapi19CustomerPaymentGateway,
} from "../src/client"
import {
  FIXED_CSOB_DATE_TIME,
  FIXED_DATE,
  PAY_ID,
  QueueHttpClient,
  RecordingSignatureBoundary,
  jsonResponse,
} from "./fixtures"
import { TestableCsobEapi19CustomerPaymentAdapter } from "./raw-csob-adapter.test-helper"

const createAdapter = (
  responses: ConstructorParameters<typeof QueueHttpClient>[0],
) => {
  const httpClient = new QueueHttpClient(responses)
  const boundary = new RecordingSignatureBoundary()
  return {
    adapter: new TestableCsobEapi19CustomerPaymentAdapter({
      environment: "sandbox",
      merchantId: "M1MIPS0000",
      signer: boundary,
      verifier: boundary,
      httpClient,
      clock: () => FIXED_DATE,
    }),
    boundary,
    httpClient,
  }
}

describe("ČSOB eAPI 1.9 extended methods", () => {
  it("echoes the gateway and a stored customer without treating informational codes as writes", async () => {
    const { adapter, httpClient } = createAdapter([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          signature: "c2ln",
        }),
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: "customer_01",
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 800,
          resultMessage: "Customer not found",
          signature: "c2ln",
        }),
      },
    ])

    await expect(adapter.echo()).resolves.toMatchObject({
      providerResultCode: "0",
      resultMessage: "OK",
    })
    await expect(adapter.echoCustomer("customer_01")).resolves.toMatchObject({
      providerResultCode: "800",
      customerId: "customer_01",
    })
    expect(httpClient.requests.map((request) => request.url)).toEqual([
      expect.stringMatching(/\/echo$/),
      expect.stringMatching(/\/echo\/customer$/),
    ])
  })

  it("initializes a custom payment and exposes the pay-by-link URL", async () => {
    const { adapter } = createAdapter([
      jsonResponse({ customerCode: "E61EC8" }),
    ])

    await expect(
      adapter.initializePayment({
        amount: { amountMinor: "123400", currencyCode: "CZK" },
        lines: [{ name: "Order", quantity: 1, amountMinor: "123400" }],
        returnUrl: "https://shop.example.com/return",
        captureMode: "automatic",
        idempotencyKey: "checkout.cart_01.revision_1",
        correlationId: "cart_01",
        orderReference: "554822",
        payOperation: "customPayment",
        customExpiry: "20261101121314",
      }),
    ).resolves.toMatchObject({
      customerCode: "E61EC8",
      payByLinkUrl: `${CSOB_CUSTOM_PAYMENT_URLS.sandbox}/E61EC8`,
    })
  })

  it("initializes and processes OneClick, Apple Pay and the payment button", async () => {
    const { adapter, httpClient } = createAdapter([
      jsonResponse({
        actions: {
          fingerprint: { browserInit: { url: "https://example.com/3ds" } },
        },
      }),
      jsonResponse({ paymentStatus: 2 }),
      jsonResponse({ payId: PAY_ID, paymentStatus: 1 }),
      jsonResponse({
        paymentStatus: 1,
        redirect: {
          method: "GET",
          url: "https://platebnibrana.csob.cz/pay/example/pt-detect/csob",
        },
      }),
    ])

    const oneclick = await adapter.initializeOneClickPayment({
      origPayId: "0e92dd54b133@HA",
      idempotencyKey: "checkout.cart_01.revision_1",
      correlationId: "cart_01",
      orderReference: "51966",
      amount: { amountMinor: "12300", currencyCode: "CZK" },
      clientIp: "192.0.2.2",
      returnUrl: "https://shop.example.com/return",
      customer: { name: "Jan Novák", email: "jan.novak@example.com" },
    })
    expect(oneclick.actions?.fingerprint?.browserInit?.url).toBe(
      "https://example.com/3ds",
    )
    await expect(
      adapter.processOneClickPayment({
        providerPaymentId: PAY_ID,
        fingerprint: {
          browser: {
            userAgent: "Mozilla/5.0",
            acceptHeader: "text/html",
            language: "cs",
            javascriptEnabled: false,
          },
        },
        idempotencyKey: "checkout.cart_01.process_1",
        correlationId: "cart_01",
      }),
    ).resolves.toMatchObject({ state: "pending" })

    await adapter.initializeApplePay({
      payload: "cGF5bG9hZA==",
      clientIp: "192.0.2.2",
      amount: { amountMinor: "12300", currencyCode: "CZK" },
      returnUrl: "https://shop.example.com/return",
      captureMode: "automatic",
      idempotencyKey: "checkout.cart_02.revision_1",
      correlationId: "cart_02",
      orderReference: "51967",
    })
    const button = await adapter.initializePaymentButton({
      amount: { amountMinor: "12300", currencyCode: "CZK" },
      clientIp: "193.1.2.3",
      returnUrl: "https://shop.example.com/return",
      idempotencyKey: "checkout.cart_03.revision_1",
      correlationId: "cart_03",
      orderReference: "11345325",
    })
    expect(button.redirect?.url).toContain("/pt-detect/csob")
    const gateway = createCsobEapi19CustomerPaymentGateway({
      environment: "sandbox",
      merchantId: "M1MIPS0000",
      signer: new RecordingSignatureBoundary(),
      verifier: new RecordingSignatureBoundary(),
      httpClient: new QueueHttpClient([]),
      clock: () => FIXED_DATE,
    })
    expect(gateway.provider).toBe("csob")
    expect(httpClient.requests.map((request) => request.url)).toEqual([
      expect.stringMatching(/\/oneclick\/init$/),
      expect.stringMatching(/\/oneclick\/process$/),
      expect.stringMatching(/\/applepay\/init$/),
      expect.stringMatching(/\/button\/init$/),
    ])
  })
})
