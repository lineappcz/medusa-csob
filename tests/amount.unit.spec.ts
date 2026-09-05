import {
  csobMinorUnitsToMedusaAmount,
  medusaAmountToCsobMinorUnits,
} from "../src/provider"

describe("ČSOB Medusa amount conversion", () => {
  it("converts supported major-unit amounts without floating-point rounding", () => {
    expect(medusaAmountToCsobMinorUnits("1234.56", "czk")).toBe("123456")
    expect(medusaAmountToCsobMinorUnits("0.01", "EUR")).toBe("1")
    expect(csobMinorUnitsToMedusaAmount("123456", "CZK")).toBe("1234.56")
  })

  it("rejects precision loss, zero charges and unsupported currencies", () => {
    expect(() => medusaAmountToCsobMinorUnits("1.001", "CZK")).toThrow(
      "more precision",
    )
    expect(() => medusaAmountToCsobMinorUnits("0", "CZK")).toThrow()
    expect(() => medusaAmountToCsobMinorUnits("1", "CHF")).toThrow(
      "does not support",
    )
  })

  it("permits zero only when the caller explicitly requests it", () => {
    expect(medusaAmountToCsobMinorUnits("0", "CZK", { allowZero: true })).toBe(
      "0",
    )
  })
})
