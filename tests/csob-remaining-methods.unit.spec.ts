import {
  assertCsobAuthFingerprint,
  assertCsobClientIp,
  assertCsobLoanCustomer,
  assertCsobMallpayCustomer,
  assertCsobMallpayOrder,
  assertCsobPurchaseCustomer,
  assertCsobPurchaseOrder,
  buildCsobLoanInitSignatureText,
  buildCsobMallpayInitSignatureText,
  buildCsobPaymentResponseSignatureText,
  buildCsobProcessSignatureText,
  buildCsobWalletInitSignatureText,
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

const createAdapter = (
  responses: ConstructorParameters<typeof QueueHttpClient>[0],
) => {
  const httpClient = new QueueHttpClient(responses)
  return {
    adapter: new TestableCsobEapi19CustomerPaymentAdapter({
      environment: "sandbox",
      merchantId: "M1MIPS0000",
      signer: new RecordingSignatureBoundary(),
      verifier: new RecordingSignatureBoundary(),
      httpClient,
      clock: () => FIXED_DATE,
    }),
    httpClient,
  }
}

const mallpayCustomer = {
  firstName: "Adam",
  lastName: "Maly",
  email: "adam.maly@example.com",
  phone: "+420800300300",
}

const mallpayOrder = {
  totalPrice: { amountMinor: "1210000", currency: "CZK" },
  totalVat: [{ amountMinor: "210000", currency: "CZK", vatRate: 21 }],
  addresses: [
    {
      addressType: "BILLING" as const,
      streetAddress: "Radlicka 333",
      city: "Praha 5",
      zip: "15000",
      country: "CZ",
    },
  ],
  items: [
    {
      code: "ABC123",
      name: "iPhone 8S",
      totalPrice: { amountMinor: "1210000", currency: "CZK" },
      totalVat: { amountMinor: "210000", currency: "CZK", vatRate: 21 },
    },
  ],
}

describe("ČSOB remaining eAPI methods and metadata", () => {
  it("covers Skip Pay, loan, Google Pay and echo variants", async () => {
    const { adapter, httpClient } = createAdapter([
      jsonResponse({ mallpayUrl: "https://skippay.example/pay" }),
      jsonResponse({ paymentStatus: 5 }),
      jsonResponse({ paymentStatus: 8 }),
      jsonResponse({ paymentStatus: 10 }),
      jsonResponse({ comparisonUrl: "https://loan.example/compare" }),
      jsonResponse({ paymentStatus: 5 }),
      jsonResponse({ paymentStatus: 8 }),
      jsonResponse({ paymentStatus: 10 }),
      jsonResponse(),
      jsonResponse({ paymentStatus: 2 }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origPayId: "0e92dd54b133@HA",
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
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          initParams: {
            countryCode: "CZ",
            supportedNetworks: ["visa"],
            merchantCapabilities: ["supports3DS"],
          },
          signature: "c2ln",
        }),
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          initParams: {
            apiVersion: 2,
            apiVersionMinor: 0,
            paymentMethodType: "CARD",
            allowedCardNetworks: ["VISA"],
            allowedCardAuthMethods: ["CRYPTOGRAM_3DS"],
            assuranceDetailsRequired: true,
            billingAddressRequired: true,
            billingAddressParametersFormat: "FULL",
            tokenizationSpecificationType: "PAYMENT_GATEWAY",
            gateway: "csob",
            gatewayMerchantId: "M1MIPS0000",
            googlepayMerchantId: "01234567890123456789",
            merchantName: "Example",
            environment: "TEST",
            totalPriceStatus: "FINAL",
            countryCode: "CZ",
          },
          signature: "c2ln",
        }),
      },
    ])

    await adapter.initializeMallpay({
      customer: mallpayCustomer,
      order: mallpayOrder,
      agreeTC: true,
      clientIp: "192.0.2.2",
      returnUrl: "https://shop.example.com/return",
      idempotencyKey: "checkout.cart_10.revision_1",
      correlationId: "cart_10",
      orderReference: "51966",
    })
    await adapter.cancelMallpay({
      providerPaymentId: PAY_ID,
      reason: "aborted",
      idempotencyKey: "cancel.cart_10.1",
      correlationId: "cart_10",
    })
    await adapter.updateMallpayLogistics({
      providerPaymentId: PAY_ID,
      date: "20191020",
      event: "delivered",
      fulfilled: {
        totalPrice: { amountMinor: "24200", currency: "CZK" },
        items: [{ code: "AX1255c", name: "Case", type: "PHYSICAL", quantity: 1 }],
      },
      idempotencyKey: "logistics.cart_10.1",
      correlationId: "cart_10",
    })
    await adapter.refundMallpay({
      providerPaymentId: PAY_ID,
      amountMinor: "1000",
      refundedItems: [{ code: "AX1255c", name: "Case" }],
      idempotencyKey: "refund.cart_10.1",
      correlationId: "cart_10",
    })
    await adapter.initializeLoan({
      purchaseId: "ZA0019S51966-1",
      clientIp: "192.0.2.2",
      amount: { amountMinor: "1789600", currencyCode: "CZK" },
      returnUrl: "https://shop.example.com/return",
      idempotencyKey: "checkout.cart_11.revision_1",
      correlationId: "cart_11",
      orderReference: "51966",
      customer: {
        firstName: "Adam",
        lastName: "Novy",
        email: "adam@example.com",
        phone: "+420800300300",
        billingAddress: {
          address1: "Radlicka 333",
          city: "Praha 5",
          zip: "15000",
          country: "CZ",
        },
      },
    })
    await adapter.cancelLoan({
      providerPaymentId: PAY_ID,
      reason: "aborted",
      idempotencyKey: "cancel.cart_11.1",
      correlationId: "cart_11",
    })
    await adapter.updateLoanLogistics({
      providerPaymentId: PAY_ID,
      event: "sent",
      idempotencyKey: "logistics.cart_11.1",
      correlationId: "cart_11",
    })
    await adapter.refundLoan({
      providerPaymentId: PAY_ID,
      amountMinor: "1000",
      reason: "returned",
      date: "20191021",
      idempotencyKey: "refund.cart_11.1",
      correlationId: "cart_11",
    })
    await adapter.initializeGooglePay({
      payload: "cGF5bG9hZA==",
      clientIp: "2001:db8::1",
      amount: { amountMinor: "12300", currencyCode: "CZK" },
      returnUrl: "https://shop.example.com/return",
      captureMode: "manual",
      idempotencyKey: "checkout.cart_12.revision_1",
      correlationId: "cart_12",
      orderReference: "51968",
      sdkUsed: true,
    })
    await adapter.processGooglePay({
      providerPaymentId: PAY_ID,
      fingerprint: {
        sdk: {
          appID: "198d0791-0025-4183-b9ae-900c88dd80e0",
          encData: "encrypted-data",
          ephemPubKey: "encoded-public-key",
          maxTimeout: 5,
          referenceNumber: "sdk-reference-number",
          transID: "7f101033-df46-4f5c-9e96-9575c924e1e7",
        },
      },
      idempotencyKey: "process.cart_12.1",
      correlationId: "cart_12",
    })
    await adapter.echoOneClick("0e92dd54b133@HA")
    await adapter.echoApplePay()
    await adapter.echoGooglePay()

    expect(httpClient.requests.map((request) => request.url)).toEqual([
      expect.stringMatching(/\/mallpay\/init$/),
      expect.stringMatching(/\/mallpay\/cancel$/),
      expect.stringMatching(/\/mallpay\/logistics$/),
      expect.stringMatching(/\/mallpay\/refund$/),
      expect.stringMatching(/\/loan\/init$/),
      expect.stringMatching(/\/loan\/cancel$/),
      expect.stringMatching(/\/loan\/logistics$/),
      expect.stringMatching(/\/loan\/refund$/),
      expect.stringMatching(/\/googlepay\/init$/),
      expect.stringMatching(/\/googlepay\/process$/),
      expect.stringMatching(/\/oneclick\/echo$/),
      expect.stringMatching(/\/applepay\/echo$/),
      expect.stringMatching(/\/googlepay\/echo$/),
    ])
  })

  it("rejects invalid metadata, IPs, fingerprints and Skip Pay input", () => {
    expect(() =>
      assertCsobPurchaseCustomer({ email: "not-an-email" }),
    ).toThrow("purchase metadata")
    expect(() =>
      assertCsobPurchaseCustomer({ mobilePhone: "800300300" }),
    ).toThrow("purchase metadata")
    expect(() =>
      assertCsobPurchaseOrder({ type: "rental" as "purchase" }),
    ).toThrow("order type")
    expect(() =>
      assertCsobPurchaseOrder({
        billing: { country: "CZ" },
      }),
    ).toThrow("purchase metadata")
    expect(() => assertCsobClientIp("not-an-ip")).toThrow("client IP")
    expect(() =>
      assertCsobAuthFingerprint({
        browser: {
          userAgent: "Mozilla",
          acceptHeader: "text/html",
          language: "cs",
          javascriptEnabled: true,
        },
      }),
    ).toThrow("fingerprint")
    expect(() =>
      assertCsobMallpayCustomer({ email: "bad" }),
    ).toThrow("alternative payment")
    expect(() =>
      assertCsobMallpayOrder({
        totalPrice: { amountMinor: "1", currency: "CZK" },
        items: [],
      }),
    ).toThrow("at least one item")
    expect(() =>
      assertCsobLoanCustomer({
        billingAddress: {
          address1: "Street",
          city: "Praha",
          zip: "11000",
          country: "CZE",
        },
      }),
    ).toThrow("alternative payment")

    assertCsobPurchaseCustomer({
      name: "Jan Novak",
      email: "jan.novak@example.com",
      mobilePhone: "+420.800300300",
      account: {
        createdAt: "2022-01-12T12:10:37+01:00",
        orderHistory: 3,
        suspicious: false,
      },
      login: { auth: "account", authAt: "2022-01-25T13:10:03+01:00" },
    })
    assertCsobPurchaseOrder({
      type: "purchase",
      delivery: "digital",
      deliveryMode: "0",
      deliveryEmail: "delivery@example.com",
      billing: {
        address1: "Karlova 1",
        city: "Praha",
        zip: "11000",
        country: "CZE",
      },
      giftCards: { totalAmount: 1000, currency: "CZK", quantity: 1 },
    })
    assertCsobClientIp("2001:db8::1")
    assertCsobAuthFingerprint({
      sdk: {
        appID: "198d0791-0025-4183-b9ae-900c88dd80e0",
        encData: "encrypted-data",
        ephemPubKey: "encoded-public-key",
        referenceNumber: "sdk-reference",
        transID: "7f101033-df46-4f5c-9e96-9575c924e1e7",
        maxTimeout: 5,
      },
    })
  })

  it("builds signatures for wallet, Skip Pay and loan requests", () => {
    expect(
      buildCsobWalletInitSignatureText({
        merchantId: "M1MIPS0000",
        orderNo: "51966",
        dttm: "20220125131559",
        clientIp: "192.0.2.2",
        totalAmount: 12300,
        currency: "CZK",
        payload: "cGF5bG9hZA==",
        returnUrl: "https://shop.example.com/return",
        returnMethod: "POST",
      }),
    ).toBe(
      "M1MIPS0000|51966|20220125131559|192.0.2.2|12300|CZK|cGF5bG9hZA==|https://shop.example.com/return|POST",
    )
    expect(
      buildCsobProcessSignatureText({
        merchantId: "M1MIPS0000",
        payId: PAY_ID,
        dttm: "20220125131615",
        fingerprint: {
          browser: {
            userAgent: "Mozilla",
            acceptHeader: "text/html",
            language: "cs",
            javascriptEnabled: false,
          },
        },
      }),
    ).toBe(
      `M1MIPS0000|${PAY_ID}|20220125131615|Mozilla|text/html|cs|false`,
    )
    expect(
      buildCsobMallpayInitSignatureText({
        merchantId: "M1MIPS0000",
        orderNo: "51966",
        customer: mallpayCustomer,
        order: mallpayOrder,
        agreeTC: true,
        dttm: "20220125131559",
        clientIp: "192.0.2.2",
        returnUrl: "https://shop.example.com/return",
        returnMethod: "POST",
      }),
    ).toContain("M1MIPS0000|51966|Adam|Maly")
    expect(
      buildCsobLoanInitSignatureText({
        merchantId: "M1MIPS0000",
        orderNo: "51966",
        purchaseId: "ZA0019S51966-1",
        dttm: "20220125131559",
        clientIp: "192.0.2.2",
        totalAmount: 1789600,
        currency: "CZK",
        returnUrl: "https://shop.example.com/return",
        returnMethod: "POST",
        language: "cs",
      }),
    ).toBe(
      "M1MIPS0000|51966|ZA0019S51966-1|20220125131559|192.0.2.2|1789600|CZK|https://shop.example.com/return|POST|cs",
    )
    expect(
      buildCsobPaymentResponseSignatureText(
        {
          payId: PAY_ID,
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          paymentStatus: 1,
          signature: "c2ln",
          actions: {
            fingerprint: { browserInit: { url: "https://example.com/3ds" } },
          },
        },
        "process",
      ),
    ).toBe(`${PAY_ID}|${FIXED_CSOB_DATE_TIME}|0|OK|1|https://example.com/3ds`)
  })

  it("initializes hosted payments with 3DS metadata, LVP and branding", async () => {
    const { adapter, httpClient } = createAdapter([jsonResponse()])
    await adapter.initializePayment(
      initializeCommand({
        payMethod: "card#LVP",
        payOperation: "oneclickPayment",
        customer: {
          name: "Jan Novak",
          email: "jan.novak@example.com",
          mobilePhone: "+420.800300300",
        },
        order: {
          type: "purchase",
          availability: "now",
          delivery: "digital",
          deliveryMode: "0",
        },
        logoVersion: 3,
        colorSchemeVersion: 2,
      }),
    )
    const body = JSON.parse(httpClient.requests[0].body as string)
    expect(body.payMethod).toBe("card#LVP")
    expect(body.customer.email).toBe("jan.novak@example.com")
    expect(body.logoVersion).toBe(3)
  })
})
