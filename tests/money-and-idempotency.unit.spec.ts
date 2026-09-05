import {
  CustomerPaymentIntegrationError,
  buildCsobMerchantData,
  createPaymentOperationFingerprint,
  deriveCsobOrderReference,
  minorUnitsToSafeNumber,
  parseCsobMerchantData,
  parseMinorUnits,
  verifyCsobMerchantData,
} from "../src/client"

describe("customer payment exact amounts and correlation", () => {
  it("keeps minor units exact and rejects non-canonical decimals", () => {
    expect(parseMinorUnits("9007199254740993", "amount")).toBe(
      9_007_199_254_740_993n,
    )
    expect(() => minorUnitsToSafeNumber("9007199254740993", "amount")).toThrow(
      expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
        code: "CUSTOMER_PAYMENT_AMOUNT_UNSAFE",
      }),
    )

    for (const invalid of ["01", "1.00", "-1", "+1", " 1", "1 "]) {
      expect(() => parseMinorUnits(invalid, "amount")).toThrow(
        expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
          code: "CUSTOMER_PAYMENT_AMOUNT_INVALID",
        }),
      )
    }
  })

  it("derives deterministic provider fields from an idempotency key", () => {
    const input = {
      idempotencyKey: "checkout.cart_01.revision_1",
      correlationId: "cart_01",
    }
    const orderReference = deriveCsobOrderReference(input)
    const merchantData = buildCsobMerchantData(input)

    expect(orderReference).toMatch(/^\d{10}$/)
    expect(deriveCsobOrderReference(input)).toBe(orderReference)
    expect(buildCsobMerchantData(input)).toBe(merchantData)
    expect(Buffer.from(merchantData, "base64").toString("utf8")).toContain(
      '"c":"cart_01"',
    )
    expect(merchantData).not.toContain(input.idempotencyKey)
    expect(parseCsobMerchantData(merchantData)).toMatchObject({
      version: 1,
      correlationId: "cart_01",
      idempotencyDigest: expect.stringMatching(/^[a-f0-9]{32}$/),
    })
    expect(() =>
      verifyCsobMerchantData({ merchantData, ...input }),
    ).not.toThrow()
  })

  it("rejects malformed or extended merchant data before correlation lookup", () => {
    const extended = Buffer.from(
      JSON.stringify({ v: 1, c: "cart_01", i: "a".repeat(32), extra: true }),
      "utf8",
    ).toString("base64")

    for (const invalid of ["not base64", "YQ==\n", extended]) {
      expect(() => parseCsobMerchantData(invalid)).toThrow(
        expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
          code: "CSOB_MERCHANT_DATA_INVALID",
        }),
      )
    }
  })

  it("detects correlation substitution and fingerprint payload changes", () => {
    const base = {
      operation: "refund",
      idempotencyKey: "refund.order_01.attempt_1",
      correlationId: "order_01",
    }
    const first = createPaymentOperationFingerprint({
      ...base,
      values: ["payment_01", "1000"],
    })
    const repeated = createPaymentOperationFingerprint({
      ...base,
      values: ["payment_01", "1000"],
    })
    const changed = createPaymentOperationFingerprint({
      ...base,
      values: ["payment_01", "1001"],
    })

    expect(first).toBe(repeated)
    expect(changed).not.toBe(first)
    expect(() =>
      verifyCsobMerchantData({
        merchantData: buildCsobMerchantData(base),
        idempotencyKey: base.idempotencyKey,
        correlationId: "order_02",
      }),
    ).toThrow(
      expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
        code: "CSOB_RETURN_CORRELATION_INVALID",
      }),
    )
  })

  it("honours an explicit numeric order reference and rejects invalid identifiers", () => {
    expect(
      deriveCsobOrderReference({
        idempotencyKey: "checkout.cart_01.revision_1",
        correlationId: "cart_01",
        orderReference: "5547",
      }),
    ).toBe("5547")
    expect(() =>
      deriveCsobOrderReference({
        idempotencyKey: "short",
        correlationId: "cart_01",
      }),
    ).toThrow(
      expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
        code: "CUSTOMER_PAYMENT_IDEMPOTENCY_KEY_INVALID",
      }),
    )
  })
})
