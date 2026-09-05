import { CSOB_CURRENCIES, CSOB_LANGUAGES } from "./csob-constants"
import { customerPaymentInvariant } from "./errors"
import { minorUnitsToSafeNumber, parseMinorUnits } from "./money"

type SigningValue = string | number | boolean | undefined

const SAFE_TEXT_PATTERN = /^\S(?:.*\S)?$/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^\+?[0-9. ]{6,20}$/
const COUNTRY_ALPHA2_PATTERN = /^[A-Z]{2}$/
const DATE_PATTERN = /^\d{8}$/

export type CsobMoney = {
  amountMinor: string
  currency: string
}

export type CsobVatAmount = CsobMoney & {
  vatRate: number
}

export type CsobMallpayCustomer = {
  firstName?: string
  lastName?: string
  fullName?: string
  titleBefore?: string
  titleAfter?: string
  email?: string
  phone?: string
  tin?: string
  vatin?: string
}

export type CsobMallpayAddress = {
  name?: string
  country?: string
  city?: string
  streetAddress?: string
  streetNumber?: string
  zip?: string
  addressType?: "BILLING" | "DELIVERY"
}

export type CsobMallpayItem = {
  code?: string
  ean?: string
  name?: string
  type?: string
  quantity?: number
  variant?: string
  description?: string
  producer?: string
  categories?: string[]
  unitPrice?: CsobMoney
  unitVat?: CsobVatAmount
  totalPrice?: CsobMoney
  totalVat?: CsobVatAmount
  productUrl?: string
}

export type CsobMallpayOrder = {
  totalPrice: CsobMoney
  totalVat?: CsobVatAmount[]
  addresses?: CsobMallpayAddress[]
  deliveryType?: string
  carrierId?: string
  carrierCustom?: string
  items: CsobMallpayItem[]
}

export type CsobMallpayOrderRef = {
  totalPrice?: CsobMoney
  totalVat?: CsobVatAmount[]
  items?: Array<
    Pick<CsobMallpayItem, "code" | "ean" | "name" | "type" | "quantity">
  >
}

export type CsobLoanAddress = {
  address1: string
  address2?: string
  city: string
  zip: string
  country: string
}

export type CsobLoanCustomer = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  billingAddress?: CsobLoanAddress
  shippingAddress?: CsobLoanAddress
}

const assertText = (
  value: string | undefined,
  maximumLength: number,
  code: string,
  pattern?: RegExp,
) => {
  if (value === undefined) {
    return
  }
  customerPaymentInvariant(
    value.length > 0 &&
      value.length <= maximumLength &&
      SAFE_TEXT_PATTERN.test(value) &&
      (pattern === undefined || pattern.test(value)),
    code,
    "ČSOB alternative payment data is invalid.",
  )
}

const assertMoney = (value: CsobMoney | undefined, code: string) => {
  if (!value) {
    return
  }
  parseMinorUnits(value.amountMinor, "alternative payment amount")
  customerPaymentInvariant(
    CSOB_CURRENCIES.includes(
      value.currency as (typeof CSOB_CURRENCIES)[number],
    ),
    code,
    "ČSOB alternative payment currency is unsupported.",
  )
}

const flattenMoney = (value: CsobMoney | undefined): SigningValue[] =>
  value
    ? [
        minorUnitsToSafeNumber(value.amountMinor, "alternative payment amount"),
        value.currency,
      ]
    : []

const flattenVat = (value: CsobVatAmount | undefined): SigningValue[] =>
  value ? [...flattenMoney(value), value.vatRate] : []

export const assertCsobMallpayCustomer = (
  customer: CsobMallpayCustomer,
): void => {
  assertText(customer.firstName, 60, "CSOB_MALLPAY_CUSTOMER_INVALID")
  assertText(customer.lastName, 60, "CSOB_MALLPAY_CUSTOMER_INVALID")
  assertText(customer.fullName, 100, "CSOB_MALLPAY_CUSTOMER_INVALID")
  assertText(
    customer.email,
    100,
    "CSOB_MALLPAY_CUSTOMER_INVALID",
    EMAIL_PATTERN,
  )
  assertText(customer.phone, 20, "CSOB_MALLPAY_CUSTOMER_INVALID", PHONE_PATTERN)
}

export const assertCsobMallpayOrder = (order: CsobMallpayOrder): void => {
  assertMoney(order.totalPrice, "CSOB_MALLPAY_ORDER_INVALID")
  customerPaymentInvariant(
    order.items.length >= 1,
    "CSOB_MALLPAY_ORDER_INVALID",
    "ČSOB Skip Pay order must contain at least one item.",
  )
  for (const item of order.items) {
    assertText(item.code, 50, "CSOB_MALLPAY_ORDER_INVALID")
    assertText(item.name, 100, "CSOB_MALLPAY_ORDER_INVALID")
    assertMoney(item.totalPrice, "CSOB_MALLPAY_ORDER_INVALID")
  }
}

export const flattenCsobMallpayCustomer = (
  customer: CsobMallpayCustomer | undefined,
): SigningValue[] => {
  if (!customer) {
    return []
  }
  return [
    customer.firstName,
    customer.lastName,
    customer.fullName,
    customer.titleBefore,
    customer.titleAfter,
    customer.email,
    customer.phone,
    customer.tin,
    customer.vatin,
  ]
}

const flattenMallpayAddress = (address: CsobMallpayAddress): SigningValue[] => [
  address.name,
  address.country,
  address.city,
  address.streetAddress,
  address.streetNumber,
  address.zip,
  address.addressType,
]

const flattenMallpayItem = (item: CsobMallpayItem): SigningValue[] => [
  item.code,
  item.ean,
  item.name,
  item.type,
  item.quantity,
  item.variant,
  item.description,
  item.producer,
  ...(item.categories ?? []),
  ...flattenMoney(item.unitPrice),
  ...flattenVat(item.unitVat),
  ...flattenMoney(item.totalPrice),
  ...flattenVat(item.totalVat),
  item.productUrl,
]

export const flattenCsobMallpayOrder = (
  order: CsobMallpayOrder | undefined,
): SigningValue[] => {
  if (!order) {
    return []
  }
  return [
    ...flattenMoney(order.totalPrice),
    ...(order.totalVat ?? []).flatMap((vat) => flattenVat(vat)),
    ...(order.addresses ?? []).flatMap((address) =>
      flattenMallpayAddress(address),
    ),
    order.deliveryType,
    order.carrierId,
    order.carrierCustom,
    ...order.items.flatMap((item) => flattenMallpayItem(item)),
  ]
}

export const flattenCsobMallpayOrderRef = (
  order: CsobMallpayOrderRef | undefined,
): SigningValue[] => {
  if (!order) {
    return []
  }
  return [
    ...flattenMoney(order.totalPrice),
    ...(order.totalVat ?? []).flatMap((vat) => flattenVat(vat)),
    ...(order.items ?? []).flatMap((item) => [
      item.code,
      item.ean,
      item.name,
      item.type,
      item.quantity,
    ]),
  ]
}

export const flattenCsobLoanCustomer = (
  customer: CsobLoanCustomer | undefined,
): SigningValue[] => {
  if (!customer) {
    return []
  }
  return [
    customer.firstName,
    customer.lastName,
    customer.email,
    customer.phone,
    customer.billingAddress?.address1,
    customer.billingAddress?.address2,
    customer.billingAddress?.city,
    customer.billingAddress?.zip,
    customer.billingAddress?.country,
    customer.shippingAddress?.address1,
    customer.shippingAddress?.address2,
    customer.shippingAddress?.city,
    customer.shippingAddress?.zip,
    customer.shippingAddress?.country,
  ]
}

export const assertCsobLoanCustomer = (
  customer: CsobLoanCustomer | undefined,
): void => {
  if (!customer) {
    return
  }
  assertText(customer.firstName, 60, "CSOB_LOAN_CUSTOMER_INVALID")
  assertText(customer.lastName, 60, "CSOB_LOAN_CUSTOMER_INVALID")
  assertText(customer.email, 100, "CSOB_LOAN_CUSTOMER_INVALID", EMAIL_PATTERN)
  assertText(customer.phone, 20, "CSOB_LOAN_CUSTOMER_INVALID", PHONE_PATTERN)
  for (const address of [customer.billingAddress, customer.shippingAddress]) {
    if (!address) {
      continue
    }
    assertText(address.address1, 50, "CSOB_LOAN_CUSTOMER_INVALID")
    assertText(address.city, 50, "CSOB_LOAN_CUSTOMER_INVALID")
    assertText(address.zip, 16, "CSOB_LOAN_CUSTOMER_INVALID")
    assertText(
      address.country,
      2,
      "CSOB_LOAN_CUSTOMER_INVALID",
      COUNTRY_ALPHA2_PATTERN,
    )
  }
}

export const assertCsobLanguage = (language: string): void => {
  customerPaymentInvariant(
    CSOB_LANGUAGES.includes(language as (typeof CSOB_LANGUAGES)[number]),
    "CSOB_LANGUAGE_UNSUPPORTED",
    "ČSOB payment language is unsupported.",
  )
}

export const assertCsobCalendarDate = (value: string): void => {
  customerPaymentInvariant(
    DATE_PATTERN.test(value),
    "CSOB_LOGISTICS_DATE_INVALID",
    "ČSOB logistics date must use YYYYMMDD.",
  )
}
