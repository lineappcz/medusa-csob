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
