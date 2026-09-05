import {
  assertCsobAuthFingerprint,
  assertCsobCalendarDate,
  assertCsobLanguage,
  assertCsobLoanCustomer,
  assertCsobMallpayCustomer,
  assertCsobMallpayOrder,
  assertCsobPurchaseCustomer,
  assertCsobPurchaseOrder,
  buildCsobLoanRefundSignatureText,
  buildCsobMallpayLogisticsSignatureText,
  buildCsobMallpayRefundSignatureText,
  buildCsobPaymentResponseSignatureText,
  flattenCsobAuthFingerprint,
  flattenCsobLoanCustomer,
  flattenCsobMallpayCustomer,
  flattenCsobMallpayOrder,
  flattenCsobMallpayOrderRef,
  flattenCsobPaymentActions,
  flattenCsobPurchaseCustomer,
  flattenCsobPurchaseOrder,
  flattenCsobRedirect,
  parseCsobPaymentActions,
  parseCsobRedirect,
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
  fullName: "Adam Maly",
  titleBefore: "Ing",
  titleAfter: "PhD",
  email: "adam.maly@example.com",
  phone: "+420800300300",
  tin: "123456789",
  vatin: "CZ123456789",
}

const mallpayOrder = {
  totalPrice: { amountMinor: "1210000", currency: "CZK" },
  totalVat: [{ amountMinor: "210000", currency: "CZK", vatRate: 21 }],
  addresses: [
    {
      name: "Adam",
      addressType: "BILLING" as const,
      streetAddress: "Radlicka",
      streetNumber: "333",
      city: "Praha 5",
      zip: "15000",
      country: "CZ",
    },
  ],
  deliveryType: "delivery",
  carrierId: "PPL",
  carrierCustom: "custom",
  items: [
    {
      code: "ABC123",
      ean: "123",
      name: "iPhone 8S",
      type: "PHYSICAL",
      quantity: 1,
      variant: "blue",
      description: "desc",
      producer: "Maker",
      categories: ["phones", "apple"],
      unitPrice: { amountMinor: "1210000", currency: "CZK" },
      unitVat: { amountMinor: "210000", currency: "CZK", vatRate: 21 },
      totalPrice: { amountMinor: "1210000", currency: "CZK" },
      totalVat: { amountMinor: "210000", currency: "CZK", vatRate: 21 },
      productUrl: "https://shop.example.com/item",
    },
  ],
}

describe("ČSOB flatten, parse and remaining validation coverage", () => {
  it("flattens full mallpay, loan, purchase and auth objects", () => {
    expect(flattenCsobMallpayCustomer(undefined)).toEqual([])
    expect(flattenCsobMallpayOrder(undefined)).toEqual([])
    expect(flattenCsobMallpayOrderRef(undefined)).toEqual([])
    expect(flattenCsobLoanCustomer(undefined)).toEqual([])
    expect(flattenCsobPurchaseCustomer(undefined)).toEqual([])
    expect(flattenCsobPurchaseOrder(undefined)).toEqual([])
    expect(flattenCsobAuthFingerprint(undefined)).toEqual([])
    expect(flattenCsobPaymentActions(undefined)).toEqual([])
    expect(flattenCsobRedirect(undefined)).toEqual([])

    expect(flattenCsobMallpayCustomer(mallpayCustomer)).toContain("Adam")
    expect(flattenCsobMallpayOrder(mallpayOrder)).toContain("PHYSICAL")
    expect(
      flattenCsobMallpayOrderRef({
        totalPrice: { amountMinor: "5000", currency: "CZK" },
        totalVat: [{ amountMinor: "868", currency: "CZK", vatRate: 21 }],
        items: [
          {
            code: "SKU",
            ean: "123",
            name: "Item",
            type: "PHYSICAL",
            quantity: 1,
          },
        ],
      }),
    ).toEqual([
      5000,
      "CZK",
      868,
      "CZK",
      21,
      "SKU",
      "123",
      "Item",
      "PHYSICAL",
      1,
    ])
    expect(
      flattenCsobLoanCustomer({
        firstName: "Jan",
        lastName: "Novak",
        email: "jan@example.com",
        phone: "+420.777000111",
        billingAddress: {
          address1: "Ulice 1",
          address2: "patro 2",
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
        shippingAddress: {
          address1: "Jina 2",
          city: "Brno",
          zip: "60200",
          country: "CZ",
        },
      }),
    ).toContain("Brno")
    expect(
      flattenCsobPurchaseCustomer({
        name: "Jan Novak",
        email: "jan@example.com",
        homePhone: "+420.111222333",
        workPhone: "+420.111222334",
        mobilePhone: "+420.777000111",
        account: {
          createdAt: "2020-01-01T00:00:00Z",
          changedAt: "2021-01-01T00:00:00Z",
          changedPwdAt: "2022-01-01T00:00:00Z",
          orderHistory: 4,
          paymentsDay: 1,
          paymentsYear: 8,
          oneclickAdds: 0,
          suspicious: false,
        },
        login: {
          auth: "account",
          authAt: "2026-03-15T12:00:00Z",
          authData: "session",
        },
      }),
    ).toContain("account")
    expect(
      flattenCsobPurchaseOrder({
        type: "purchase",
        availability: "2026-03-20T10:00:00Z",
        delivery: "shipping",
        deliveryMode: "0",
        deliveryEmail: "ship@example.com",
        nameMatch: true,
        addressMatch: false,
        billing: {
          address1: "Ulice 1",
          address2: "patro 2",
          address3: "dvere 3",
          city: "Praha",
          zip: "11000",
          state: "10",
          country: "CZE",
        },
        shipping: {
          address1: "Jina 2",
          city: "Brno",
          zip: "60200",
          country: "CZE",
        },
        shippingAddedAt: "20260315121030",
        reorder: true,
        giftCards: { totalAmount: 1000, currency: "CZK", quantity: 1 },
      }),
    ).toContain("shipping")
    expect(
      flattenCsobAuthFingerprint({
        browser: {
          userAgent: "Mozilla",
          acceptHeader: "text/html",
          language: "cs",
          javascriptEnabled: true,
          colorDepth: 24,
          screenHeight: 1080,
          screenWidth: 1920,
          timezone: 60,
          javaEnabled: false,
          challengeWindowSize: "05",
        },
      }),
    ).toEqual([
      "Mozilla",
      "text/html",
      "cs",
      true,
      24,
      1080,
      1920,
      60,
      false,
      "05",
    ])
    expect(
      flattenCsobAuthFingerprint({
        sdk: {
          appID: "app-id-value-012345678901234567890123",
          encData: "enc",
          ephemPubKey: "key",
          maxTimeout: 10,
          referenceNumber: "ref",
          transID: "tx-id-value-012345678901234567890123",
        },
      }),
    ).toEqual([
      "app-id-value-012345678901234567890123",
      "enc",
      "key",
      10,
      "ref",
      "tx-id-value-012345678901234567890123",
    ])
    expect(
      flattenCsobPaymentActions({
        fingerprint: {
          browserInit: {
            url: "https://example.com/3ds",
            method: "POST",
            vars: { creq: "abc" },
          },
          sdkInit: {
            directoryServerID: "ds",
            schemeId: "visa",
            messageVersion: "2.2.0",
          },
        },
        authenticate: {
          browserChallenge: { url: "https://example.com/challenge" },
          sdkChallenge: {
            threeDSServerTransID: "t1",
            acsReferenceNumber: "acs",
            acsTransID: "a1",
            acsSignedContent: "signed",
          },
        },
      }),
    ).toContain("https://example.com/3ds")
    expect(
      flattenCsobRedirect({
        method: "POST",
        url: "https://platebnibrana.csob.cz/pay",
        params: { payId: PAY_ID },
      }),
    ).toEqual(["POST", "https://platebnibrana.csob.cz/pay", PAY_ID])
  })

  it("parses signed actions and redirects and rejects malformed values", () => {
    expect(parseCsobPaymentActions(undefined)).toBeUndefined()
    expect(parseCsobRedirect(undefined)).toBeUndefined()
    expect(
      parseCsobPaymentActions({
        fingerprint: {
          browserInit: {
            url: "https://example.com/3ds",
            method: "GET",
            vars: { nonce: "1" },
          },
          sdkInit: {
            directoryServerID: "ds",
            schemeId: "visa",
            messageVersion: "2.2.0",
          },
        },
        authenticate: {
          browserChallenge: { url: "https://example.com/challenge" },
          sdkChallenge: {
            threeDSServerTransID: "t1",
            acsReferenceNumber: "acs",
            acsTransID: "a1",
            acsSignedContent: "signed",
          },
        },
      }),
    ).toMatchObject({
      fingerprint: { sdkInit: { schemeId: "visa" } },
      authenticate: { sdkChallenge: { acsTransID: "a1" } },
    })
    expect(
      parseCsobRedirect({
        method: "GET",
        url: "https://example.com/return",
        params: { a: "b" },
      }),
    ).toEqual({
      method: "GET",
      url: "https://example.com/return",
      params: { a: "b" },
    })
    expect(() => parseCsobPaymentActions("bad")).toThrow("actions")
    expect(() =>
      parseCsobPaymentActions({ fingerprint: { browserInit: {} } }),
    ).toThrow("URL")
    expect(() =>
      parseCsobRedirect({ method: "PUT", url: "https://example.com" }),
    ).toThrow("redirect")
  })

  it("validates remaining purchase, mallpay, loan and fingerprint fields", () => {
    expect(() =>
      assertCsobPurchaseCustomer({
        account: { createdAt: "yesterday" },
      }),
    ).toThrow("timestamp")
    expect(() =>
      assertCsobPurchaseCustomer({
        account: { orderHistory: -1 },
      }),
    ).toThrow("count")
    expect(() =>
      assertCsobPurchaseCustomer({
        login: { auth: "password" as "account" },
      }),
    ).toThrow("authentication method")
    expect(() => assertCsobPurchaseOrder({ deliveryEmail: "bad" })).toThrow(
      "text field",
    )
    expect(() => assertCsobPurchaseOrder({ deliveryMode: "9" as "0" })).toThrow(
      "delivery mode",
    )
    expect(() =>
      assertCsobPurchaseOrder({ shippingAddedAt: "not-a-date" }),
    ).toThrow("shipping added")
    expect(() =>
      assertCsobPurchaseOrder({
        giftCards: { totalAmount: -5 },
      }),
    ).toThrow("gift-card")
    expect(() =>
      assertCsobMallpayOrder({
        totalPrice: { amountMinor: "100", currency: "XXX" },
        items: [
          {
            name: "Item",
            totalPrice: { amountMinor: "100", currency: "CZK" },
          },
        ],
      }),
    ).toThrow("currency")
    expect(() => assertCsobMallpayCustomer({ firstName: " " })).toThrow(
      "alternative payment",
    )
    expect(() =>
      assertCsobLoanCustomer({
        firstName: "Jan",
        lastName: "Novak",
        email: "jan@example.com",
        phone: "+420.777000111",
        shippingAddress: {
          address1: "Ulice 1",
          city: "Praha",
          zip: "11000",
          country: "CZE",
        },
      }),
    ).toThrow("alternative payment")
    expect(() => assertCsobLanguage("xx")).toThrow("language")
    expect(() => assertCsobCalendarDate("2026-03-15")).toThrow("YYYYMMDD")
    expect(() =>
      assertCsobAuthFingerprint({
        browser: {
          userAgent: "Mozilla",
          acceptHeader: "text/html",
          language: "cs",
          javascriptEnabled: true,
          colorDepth: 24,
          screenHeight: 1080,
          screenWidth: 1920,
          timezone: 60,
          javaEnabled: false,
          challengeWindowSize: "99",
        },
      }),
    ).toThrow("challenge window")
    expect(() =>
      assertCsobAuthFingerprint({
        sdk: {
          appID: "198d0791-0025-4183-b9ae-900c88dd80e0",
          encData: "encrypted-data",
          ephemPubKey: "encoded-public-key",
          referenceNumber: "sdk-reference",
          transID: "7f101033-df46-4f5c-9e96-9575c924e1e7",
          maxTimeout: 2,
        },
      }),
    ).toThrow("timeout")
    assertCsobLanguage("cs")
    assertCsobCalendarDate("20191020")
    assertCsobPurchaseOrder({
      shippingAddedAt: "2022-01-12T12:10:37+01:00",
      giftCards: { totalAmount: 0, currency: "CZK", quantity: 0 },
    })
  })

  it("builds remaining mallpay, loan and wallet-echo signatures", () => {
    expect(
      buildCsobMallpayLogisticsSignatureText({
        merchantId: "M1MIPS0000",
        payId: PAY_ID,
        event: "sent",
        date: "20191020",
        fulfilled: {
          totalPrice: { amountMinor: "24200", currency: "CZK" },
          items: [
            { code: "AX1255c", name: "Case", type: "PHYSICAL", quantity: 1 },
          ],
        },
        deliveryTrackingNumber: "TRACK1",
        dttm: FIXED_CSOB_DATE_TIME,
      }),
    ).toContain(`M1MIPS0000|${PAY_ID}|sent|20191020`)
    expect(
      buildCsobMallpayRefundSignatureText({
        merchantId: "M1MIPS0000",
        payId: PAY_ID,
        dttm: FIXED_CSOB_DATE_TIME,
        amount: 1000,
        refundedItems: [{ code: "AX1255c", name: "Case" }],
      }),
    ).toBe(`M1MIPS0000|${PAY_ID}|${FIXED_CSOB_DATE_TIME}|1000|AX1255c|Case`)
    expect(
      buildCsobLoanRefundSignatureText({
        merchantId: "M1MIPS0000",
        payId: PAY_ID,
        dttm: FIXED_CSOB_DATE_TIME,
        amount: 1000,
        reason: "returned",
        date: "20191021",
      }),
    ).toBe(
      `M1MIPS0000|${PAY_ID}|${FIXED_CSOB_DATE_TIME}|1000|returned|20191021`,
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
          mallpayUrl: "https://skippay.example/pay",
        },
        "mallpayInit",
      ),
    ).toBe(
      `${PAY_ID}|${FIXED_CSOB_DATE_TIME}|0|OK|1|https://skippay.example/pay`,
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
          comparisonUrl: "https://loan.example/compare",
        },
        "loanInit",
      ),
    ).toBe(
      `${PAY_ID}|${FIXED_CSOB_DATE_TIME}|0|OK|1|https://loan.example/compare`,
    )
    expect(
      buildCsobPaymentResponseSignatureText(
        {
          payId: "",
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          paymentStatus: 0,
          signature: "c2ln",
          initParams: {
            countryCode: "CZ",
            supportedNetworks: ["visa"],
            merchantCapabilities: ["supports3DS"],
          },
        },
        "applepayEcho",
      ),
    ).toBe(`${FIXED_CSOB_DATE_TIME}|0|OK|CZ|visa|supports3DS`)
    expect(
      buildCsobPaymentResponseSignatureText(
        {
          payId: "",
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          paymentStatus: 0,
          signature: "c2ln",
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
        },
        "googlepayEcho",
      ),
    ).toContain(`${FIXED_CSOB_DATE_TIME}|0|OK|2|0|CARD|VISA`)
    expect(
      buildCsobPaymentResponseSignatureText(
        {
          payId: "",
          dttm: FIXED_CSOB_DATE_TIME,
          resultCode: 0,
          resultMessage: "OK",
          paymentStatus: 0,
          signature: "c2ln",
        },
        "echo",
      ),
    ).toBe(`${FIXED_CSOB_DATE_TIME}|0|OK`)
  })
})

describe("ČSOB remaining adapter branches", () => {
  it("uses GET echo and GET return methods", async () => {
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
      jsonResponse({ customerCode: "E61EC8" }),
      jsonResponse({ paymentStatus: 2 }),
      jsonResponse({ paymentStatus: 1 }),
      jsonResponse({ paymentStatus: 8 }),
      jsonResponse({ paymentStatus: 4 }),
    ])

    await expect(adapter.echo("GET")).resolves.toMatchObject({
      providerResultCode: "0",
    })
    expect(httpClient.requests[0].method).toBe("GET")
    expect(httpClient.requests[0].url).toMatch(/\/echo\/M1MIPS0000\//)
    expect(httpClient.requests[0].body).toBeUndefined()

    await adapter.initializePayment({
      amount: { amountMinor: "123400", currencyCode: "CZK" },
      lines: [{ name: "Order", quantity: 1, amountMinor: "123400" }],
      returnUrl: "https://shop.example.com/return",
      captureMode: "automatic",
      idempotencyKey: "checkout.cart_20.revision_1",
      correlationId: "cart_20",
      orderReference: "554822",
      returnMethod: "GET",
    })
    expect(JSON.parse(httpClient.requests[1].body as string).returnMethod).toBe(
      "GET",
    )

    await adapter.initializeOneClickPayment({
      origPayId: "0e92dd54b133@HA",
      idempotencyKey: "checkout.cart_21.revision_1",
      correlationId: "cart_21",
      clientInitiated: false,
      returnMethod: "GET",
      returnUrl: "https://shop.example.com/return",
    })
    expect(JSON.parse(httpClient.requests[2].body as string).returnMethod).toBe(
      "GET",
    )

    await adapter.initializePaymentButton({
      amount: { amountMinor: "12300", currencyCode: "CZK" },
      clientIp: "193.1.2.3",
      returnUrl: "https://shop.example.com/return",
      idempotencyKey: "checkout.cart_22.revision_1",
      correlationId: "cart_22",
      language: "en",
      brand: "csob",
      returnMethod: "GET",
    })
    expect(JSON.parse(httpClient.requests[3].body as string).returnMethod).toBe(
      "GET",
    )

    await adapter.refundMallpay({
      providerPaymentId: PAY_ID,
      idempotencyKey: "refund.cart_10.1",
      correlationId: "cart_10",
    })
    await adapter.processOneClickPayment({
      providerPaymentId: PAY_ID,
      idempotencyKey: "process.cart_21.1",
      correlationId: "cart_21",
    })
  })

  it("rejects remaining adapter validation errors", async () => {
    const { adapter } = createAdapter([])

    await expect(adapter.echoCustomer("")).rejects.toThrow("customer ID")
    await expect(
      adapter.initializeOneClickPayment({
        origPayId: "short",
        idempotencyKey: "k",
        correlationId: "c",
        clientIp: "192.0.2.2",
      }),
    ).rejects.toThrow()
    await expect(
      adapter.initializeOneClickPayment({
        origPayId: PAY_ID,
        idempotencyKey: "k",
        correlationId: "c",
      }),
    ).rejects.toThrow("client IP")
    await expect(
      adapter.initializeApplePay({
        payload: "not-base64!",
        clientIp: "192.0.2.2",
        amount: { amountMinor: "12300", currencyCode: "CZK" },
        returnUrl: "https://shop.example.com/return",
        captureMode: "automatic",
        idempotencyKey: "k",
        correlationId: "c",
      }),
    ).rejects.toThrow("Base64")
    await expect(
      adapter.initializePaymentButton({
        amount: { amountMinor: "12300", currencyCode: "EUR" },
        clientIp: "192.0.2.2",
        returnUrl: "https://shop.example.com/return",
        idempotencyKey: "k",
        correlationId: "c",
      }),
    ).rejects.toThrow("CZK")
    await expect(
      adapter.initializeMallpay({
        customer: mallpayCustomer,
        order: mallpayOrder,
        agreeTC: false,
        clientIp: "192.0.2.2",
        returnUrl: "https://shop.example.com/return",
        idempotencyKey: "k",
        correlationId: "c",
      }),
    ).rejects.toThrow("terms")
    await expect(
      adapter.initializeLoan({
        purchaseId: "x",
        clientIp: "192.0.2.2",
        amount: { amountMinor: "1789600", currencyCode: "CZK" },
        returnUrl: "https://shop.example.com/return",
        idempotencyKey: "k",
        correlationId: "c",
      }),
    ).rejects.toThrow("purchase ID")
    await expect(
      adapter.processApplePay({
        providerPaymentId: PAY_ID,
        idempotencyKey: "k",
        correlationId: "c",
      }),
    ).rejects.toThrow("fingerprint")
    await expect(
      adapter.initializePayment({
        amount: { amountMinor: "123400", currencyCode: "CZK" },
        lines: [{ name: "Order", quantity: 1, amountMinor: "123400" }],
        returnUrl: "https://shop.example.com/return",
        captureMode: "automatic",
        idempotencyKey: "k",
        correlationId: "c",
        returnMethod: "PUT" as "POST",
      }),
    ).rejects.toThrow("return method")
  })
})
