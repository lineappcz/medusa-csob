import {
  CustomerPaymentIntegrationError,
  mapCsobPaymentState,
} from "../src/client"

describe("ČSOB payment status mapping", () => {
  test.each([
    [1, "pending"],
    [2, "pending"],
    [3, "cancelled"],
    [4, "authorized"],
    [5, "cancelled"],
    [6, "failed"],
    [7, "captured"],
    [8, "paid"],
    [9, "refund_pending"],
    [10, "refunded"],
  ] as const)("maps provider status %s to %s", (status, expected) => {
    expect(mapCsobPaymentState(status)).toBe(expected)
  })

  it("distinguishes a known partial refund from a full refund", () => {
    expect(
      mapCsobPaymentState(10, {
        capturedAmountMinor: "10000",
        refundedAmountMinor: "2500",
      }),
    ).toBe("partially_refunded")
    expect(
      mapCsobPaymentState(10, {
        capturedAmountMinor: "10000",
        refundedAmountMinor: "10000",
      }),
    ).toBe("refunded")
  })

  it("fails closed for unknown provider states", () => {
    expect(() => mapCsobPaymentState(11)).toThrow(
      expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
        code: "CSOB_PAYMENT_STATUS_UNKNOWN",
        outcome: "UNKNOWN",
      }),
    )
  })

  it("rejects impossible refund reconciliation", () => {
    expect(() =>
      mapCsobPaymentState(10, {
        capturedAmountMinor: "10000",
        refundedAmountMinor: "10001",
      }),
    ).toThrow(
      expect.objectContaining<Partial<CustomerPaymentIntegrationError>>({
        code: "CUSTOMER_PAYMENT_RECONCILIATION_INVALID",
      }),
    )
  })
})
