import { generateKeyPairSync, sign } from "node:crypto"
import { PaymentSessionStatus } from "@medusajs/framework/utils"
import CsobProvider, { type CsobProviderOptions } from "../src/provider/service"
import { buildCsobPaymentResponseSignatureText } from "../src/client"
import { MemoryStore } from "./memory-store"
import {
  PAY_ID,
  FIXED_DATE,
  FIXED_CSOB_DATE_TIME,
  QueueHttpClient,
  jsonResponse,
} from "./fixtures"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const response = (status: number) => {
  const wire = {
    payId: PAY_ID,
    dttm: FIXED_CSOB_DATE_TIME,
    resultCode: 0,
    resultMessage: "OK",
    paymentStatus: status,
    signature: "",
  }
  const signature = sign(
    "sha256",
    Buffer.from(buildCsobPaymentResponseSignatureText(wire, "payment")),
    keys.privateKey,
  ).toString("base64")
  return jsonResponse({ ...wire, signature })
}
const setup = (
  statuses: number[],
  overrides: Partial<CsobProviderOptions> = {},
) => {
  const http = new QueueHttpClient(statuses.map(response))
  const options: CsobProviderOptions = {
    environment: "sandbox",
    merchant_id: "M1MIPS0000",
    merchant_private_key_base64: Buffer.from(
      keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    ).toString("base64"),
    gateway_public_key_base64: Buffer.from(
      keys.publicKey.export({ type: "spki", format: "pem" }),
    ).toString("base64"),
    allowed_return_origins: ["https://shop.example.com"],
    return_url: "https://shop.example.com/return",
    namespace: "test",
    operation_store: new MemoryStore(),
    http_client: http,
    clock: () => FIXED_DATE,
    ...overrides,
  }
  return { provider: new CsobProvider({}, options), http, options }
}
const input = {
  amount: 123.45,
  currency_code: "czk",
  context: { idempotency_key: "session-one" },
}
describe("native Medusa payment lifecycle", () => {
  it("initializes exactly once, authorizes from bank status and captures once", async () => {
    const { provider, http } = setup([1, 4, 4, 7])
    const created = await provider.initiatePayment(input)
    expect(await provider.initiatePayment(input)).toEqual(created)
    expect(http.requests).toHaveLength(1)
    const body = JSON.parse(http.requests[0].body!)
    expect(body.totalAmount).toBe(12345)
    expect(created.data?.redirect_url).toMatch(/payment\/process/)
    expect(created.data?.method).toBe("card")
    expect(
      await provider.authorizePayment({ data: created.data }),
    ).toMatchObject({ status: PaymentSessionStatus.AUTHORIZED })
    await provider.capturePayment({ data: created.data })
    await provider.capturePayment({ data: created.data })
    expect(
      http.requests.filter((r) => r.url.includes("/payment/close")),
    ).toHaveLength(1)
  })
  it("records partial refunds and rejects duplicate refund calls", async () => {
    const { provider, http } = setup([1, 8, 9])
    const created = await provider.initiatePayment(input)
    const refund = {
      data: created.data,
      amount: 10,
      context: { idempotency_key: "refund-one" },
    }
    await provider.refundPayment(refund)
    await provider.refundPayment(refund)
    expect(
      http.requests.filter((r) => r.url.includes("/payment/refund")),
    ).toHaveLength(1)
    await expect(
      provider.refundPayment({
        ...refund,
        amount: 999,
        context: { idempotency_key: "refund-two" },
      }),
    ).rejects.toThrow("remaining")
  })
  it("cancels pending payments once and rejects client identity tampering", async () => {
    const { provider, http } = setup([1, 2, 5])
    const created = await provider.initiatePayment(input)
    await expect(
      provider.authorizePayment({ data: { ...created.data, pay_id: "other" } }),
    ).rejects.toThrow("mismatched")
    await provider.deletePayment({ data: created.data })
    await provider.cancelPayment({ data: created.data })
    expect(
      http.requests.filter((r) => r.url.includes("/payment/reverse")),
    ).toHaveLength(1)
  })
  it("rejects changed amounts and never trusts a browser return as a webhook", async () => {
    const { provider } = setup([1, 1, 8])
    const created = await provider.initiatePayment(input)
    await expect(
      provider.updatePayment({ ...input, amount: 99, data: created.data }),
    ).rejects.toThrow("changed amount")
    expect(
      await provider.updatePayment({ ...input, data: created.data }),
    ).toMatchObject({ status: PaymentSessionStatus.PENDING })
    expect(
      await provider.retrievePayment({ data: created.data }),
    ).toMatchObject({ status: PaymentSessionStatus.CAPTURED })
    expect(
      await provider.getWebhookActionAndData({
        data: { paymentStatus: 8 },
        rawData: "",
        headers: {},
      }),
    ).toEqual({ action: "not_supported" })
    await provider.__shutdown()
  })
  it("initializes a custom payment and a OneClick charge from session context", async () => {
    const { provider, http } = setup([1, 1])
    const custom = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "custom",
        custom_expiry: "20261101121314",
        customer: {
          name: "Jan Novak",
          email: "jan.novak@example.com",
        },
      },
      context: { idempotency_key: "session-custom" },
    })
    expect(JSON.parse(http.requests[0].body!).payOperation).toBe(
      "customPayment",
    )
    expect(custom.data?.method).toBe("custom")

    const oneclick = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "oneclick",
        orig_pay_id: PAY_ID,
        client_ip: "192.0.2.2",
      },
      context: { idempotency_key: "session-oneclick" },
    })
    expect(http.requests[1].url).toContain("/oneclick/init")
    expect(oneclick.data?.method).toBe("oneclick")
  })
  it("starts wallet, button and loan sessions and processes a fingerprint", async () => {
    const { provider, http } = setup([1, 1, 1, 1, 1, 2, 4])
    await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "applepay",
        payload: "cGF5bG9hZA==",
        client_ip: "192.0.2.2",
      },
      context: { idempotency_key: "session-apple" },
    })
    expect(http.requests[0].url).toContain("/applepay/init")
    const button = await provider.initiatePayment({
      ...input,
      data: { csob_method: "button", client_ip: "192.0.2.2" },
      context: { idempotency_key: "session-button" },
    })
    expect(http.requests[1].url).toContain("/button/init")
    const loan = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "loan",
        client_ip: "192.0.2.2",
        purchase_id: "ZA0019S51966-1",
      },
      context: { idempotency_key: "session-loan" },
    })
    expect(http.requests[2].url).toContain("/loan/init")
    await provider.updatePayment({
      ...input,
      data: {
        ...button.data,
        fingerprint: {
          browser: {
            userAgent: "Mozilla",
            acceptHeader: "text/html",
            language: "cs",
            javascriptEnabled: false,
          },
        },
      },
    })
    const apple = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "applepay",
        payload: "cGF5bG9hZA==",
        client_ip: "192.0.2.2",
      },
      context: { idempotency_key: "session-apple-2" },
    })
    await provider.updatePayment({
      ...input,
      data: {
        ...apple.data,
        fingerprint: {
          browser: {
            userAgent: "Mozilla",
            acceptHeader: "text/html",
            language: "cs",
            javascriptEnabled: false,
          },
        },
      },
    })
    expect(loan.data?.method).toBe("loan")
    expect(
      http.requests.some((request) =>
        request.url.includes("/applepay/process"),
      ),
    ).toBe(true)
  })
  it("starts Skip Pay and Google Pay and routes logistics, cancel and refund", async () => {
    const { provider, http } = setup([1, 1, 2, 4, 1, 1, 1, 5, 1, 8, 8, 8, 10])
    const mallpay = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "mallpay",
        client_ip: "192.0.2.2",
        agree_tc: true,
        mallpay_customer: {
          firstName: "Adam",
          lastName: "Maly",
          email: "adam.maly@example.com",
        },
        mallpay_order: {
          totalPrice: { amountMinor: "12345", currency: "CZK" },
          items: [
            {
              name: "Item",
              totalPrice: { amountMinor: "12345", currency: "CZK" },
            },
          ],
        },
      },
      context: { idempotency_key: "session-mallpay" },
    })
    expect(http.requests[0].url).toContain("/mallpay/init")
    expect(mallpay.data?.method).toBe("mallpay")

    const google = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "googlepay",
        payload: "cGF5bG9hZA==",
        client_ip: "192.0.2.2",
      },
      context: { idempotency_key: "session-google" },
    })
    await provider.updatePayment({
      ...input,
      data: {
        ...google.data,
        fingerprint: {
          browser: {
            userAgent: "Mozilla",
            acceptHeader: "text/html",
            language: "cs",
            javascriptEnabled: false,
          },
        },
      },
    })
    expect(
      http.requests.some((request) =>
        request.url.includes("/googlepay/process"),
      ),
    ).toBe(true)

    await provider.updatePayment({
      ...input,
      data: {
        ...mallpay.data,
        mallpay_event: "sent",
        mallpay_date: "20191020",
      },
    })
    expect(
      http.requests.some((request) =>
        request.url.includes("/mallpay/logistics"),
      ),
    ).toBe(true)

    await provider.cancelPayment({
      data: { ...mallpay.data, reason: "aborted" },
    })
    expect(
      http.requests.some((request) => request.url.includes("/mallpay/cancel")),
    ).toBe(true)

    const loan = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "loan",
        client_ip: "192.0.2.2",
        purchase_id: "ZA0019S51966-1",
      },
      context: { idempotency_key: "session-loan-2" },
    })
    await provider.updatePayment({
      ...input,
      data: { ...loan.data, loan_event: "sent" },
    })
    expect(
      http.requests.some((request) => request.url.includes("/loan/logistics")),
    ).toBe(true)
    await provider.refundPayment({
      amount: 10,
      data: {
        ...loan.data,
        reason: "returned",
        date: "20191021",
      },
      context: { idempotency_key: "refund-loan-1" },
    })
    expect(
      http.requests.some((request) => request.url.includes("/loan/refund")),
    ).toBe(true)
  })
  it("rejects unsupported checkout methods and enrols a OneClick template", async () => {
    const { provider, http } = setup([1])
    await expect(
      provider.initiatePayment({
        ...input,
        data: { csob_method: "bitcoin" },
        context: { idempotency_key: "session-bad" },
      }),
    ).rejects.toThrow("Unsupported")
    const template = await provider.initiatePayment({
      ...input,
      data: {
        csob_method: "oneclick",
        create_template: true,
        customer_id: "customer_01",
        pay_method: "card#LVP",
        logo_version: 3,
        color_scheme_version: 2,
        return_method: "GET",
      },
      context: { idempotency_key: "session-template" },
    })
    const body = JSON.parse(http.requests[0].body!)
    expect(body.payOperation).toBe("oneclickPayment")
    expect(body.payMethod).toBe("card#LVP")
    expect(body.returnMethod).toBe("GET")
    expect(template.data?.method).toBe("oneclick")
  })
  it("rejects incomplete configuration, missing identity and checkout maintenance", async () => {
    expect(() => CsobProvider.validateOptions({})).toThrow()
    const { provider, options } = setup([])
    expect(() =>
      CsobProvider.validateOptions({ ...options, operation_store: undefined }),
    ).toThrow("storage")
    expect(() =>
      CsobProvider.validateOptions({ ...options, capture_mode: "bad" }),
    ).toThrow("capture mode")
    await expect(
      provider.initiatePayment({ ...input, context: {} }),
    ).rejects.toThrow("identity")
    const maintained = setup([], {
      maintenance_mode: true,
      maintenance_reference: "release:test-1234",
    }).provider
    await expect(maintained.initiatePayment(input)).rejects.toThrow(
      "maintenance",
    )
  })
})
