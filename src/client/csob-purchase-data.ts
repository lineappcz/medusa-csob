import { isCsobDateTime } from "./csob-date"
import { customerPaymentInvariant } from "./errors"

type SigningValue = string | number | boolean | undefined

const SAFE_TEXT_PATTERN = /^\S(?:.*\S)?$/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_3DS_PATTERN = /^\+\d{1,4}\.\d{1,14}$/
const COUNTRY_ALPHA3_PATTERN = /^[A-Z]{3}$/
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

export const CSOB_ORDER_TYPES = [
  "purchase",
  "balance",
  "prepaid",
  "cash",
  "check",
] as const

export const CSOB_ORDER_DELIVERIES = [
  "shipping",
  "shipping_verified",
  "instore",
  "digital",
  "ticket",
  "order",
] as const

export const CSOB_ORDER_DELIVERY_MODES = ["0", "1", "2", "3"] as const

export const CSOB_LOGIN_AUTHS = [
  "guest",
  "account",
  "federated",
  "issuer",
  "thirdparty",
  "fido",
  "fido_signed",
  "api",
] as const

export type CsobPurchaseAccount = {
  createdAt?: string
  changedAt?: string
  changedPwdAt?: string
  orderHistory?: number
  paymentsDay?: number
  paymentsYear?: number
  oneclickAdds?: number
  suspicious?: boolean
}

export type CsobPurchaseLogin = {
  auth?: (typeof CSOB_LOGIN_AUTHS)[number]
  authAt?: string
  authData?: string
}

export type CsobPurchaseAddress = {
  address1?: string
  address2?: string
  address3?: string
  city?: string
  zip?: string
  state?: string
  country?: string
}

export type CsobPurchaseGiftCards = {
  totalAmount?: number
  currency?: string
  quantity?: number
}

export type CsobPurchaseCustomer = {
  name?: string
  email?: string
  homePhone?: string
  workPhone?: string
  mobilePhone?: string
  account?: CsobPurchaseAccount
  login?: CsobPurchaseLogin
}

export type CsobPurchaseOrder = {
  type?: (typeof CSOB_ORDER_TYPES)[number]
  availability?: string
  delivery?: (typeof CSOB_ORDER_DELIVERIES)[number]
  deliveryMode?: (typeof CSOB_ORDER_DELIVERY_MODES)[number]
  deliveryEmail?: string
  nameMatch?: boolean
  addressMatch?: boolean
  billing?: CsobPurchaseAddress
  shipping?: CsobPurchaseAddress
  shippingAddedAt?: string
  reorder?: boolean
  giftCards?: CsobPurchaseGiftCards
}

const assertOptionalText = ({
  value,
  maximumLength,
  code,
  pattern,
}: {
  value: string | undefined
  maximumLength: number
  code: string
  pattern?: RegExp
}): void => {
  if (value === undefined) {
    return
  }
  customerPaymentInvariant(
    typeof value === "string" &&
      value.length <= maximumLength &&
      SAFE_TEXT_PATTERN.test(value) &&
      (pattern === undefined || pattern.test(value)),
    code,
    "ČSOB purchase metadata contains an invalid text field.",
  )
}

const assertOptionalDateTime = (value: string | undefined, code: string) => {
  if (value === undefined) {
    return
  }
  customerPaymentInvariant(
    ISO_DATE_TIME_PATTERN.test(value),
    code,
    "ČSOB purchase metadata contains an invalid timestamp.",
  )
}

const assertOptionalCount = (value: number | undefined, code: string) => {
  if (value === undefined) {
    return
  }
  customerPaymentInvariant(
    Number.isSafeInteger(value) && value >= 0,
    code,
    "ČSOB purchase metadata contains an invalid count.",
  )
}

const assertAddress = (address: CsobPurchaseAddress | undefined): void => {
  if (!address) {
    return
  }
  assertOptionalText({
    value: address.address1,
    maximumLength: 50,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
  })
  assertOptionalText({
    value: address.address2,
    maximumLength: 50,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
  })
  assertOptionalText({
    value: address.address3,
    maximumLength: 50,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
  })
  assertOptionalText({
    value: address.city,
    maximumLength: 50,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
  })
  assertOptionalText({
    value: address.zip,
    maximumLength: 16,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
  })
  assertOptionalText({
    value: address.state,
    maximumLength: 3,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
  })
  assertOptionalText({
    value: address.country,
    maximumLength: 3,
    code: "CSOB_PURCHASE_ADDRESS_INVALID",
    pattern: COUNTRY_ALPHA3_PATTERN,
  })
}

export const assertCsobPurchaseCustomer = (
  customer: CsobPurchaseCustomer | undefined,
): void => {
  if (!customer) {
    return
  }
  assertOptionalText({
    value: customer.name,
    maximumLength: 45,
    code: "CSOB_PURCHASE_CUSTOMER_INVALID",
  })
  assertOptionalText({
    value: customer.email,
    maximumLength: 100,
    code: "CSOB_PURCHASE_CUSTOMER_INVALID",
    pattern: EMAIL_PATTERN,
  })
  for (const phone of [
    customer.homePhone,
    customer.workPhone,
    customer.mobilePhone,
  ]) {
    assertOptionalText({
      value: phone,
      maximumLength: 16,
      code: "CSOB_PURCHASE_CUSTOMER_INVALID",
      pattern: PHONE_3DS_PATTERN,
    })
  }
  if (customer.account) {
    assertOptionalDateTime(
      customer.account.createdAt,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalDateTime(
      customer.account.changedAt,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalDateTime(
      customer.account.changedPwdAt,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalCount(
      customer.account.orderHistory,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalCount(
      customer.account.paymentsDay,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalCount(
      customer.account.paymentsYear,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalCount(
      customer.account.oneclickAdds,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
  }
  if (customer.login) {
    customerPaymentInvariant(
      customer.login.auth === undefined ||
        CSOB_LOGIN_AUTHS.includes(customer.login.auth),
      "CSOB_PURCHASE_CUSTOMER_INVALID",
      "ČSOB login authentication method is unsupported.",
    )
    assertOptionalDateTime(
      customer.login.authAt,
      "CSOB_PURCHASE_CUSTOMER_INVALID",
    )
    assertOptionalText({
      value: customer.login.authData,
      maximumLength: 255,
      code: "CSOB_PURCHASE_CUSTOMER_INVALID",
    })
  }
}

export const assertCsobPurchaseOrder = (
  order: CsobPurchaseOrder | undefined,
): void => {
  if (!order) {
    return
  }
  customerPaymentInvariant(
    order.type === undefined || CSOB_ORDER_TYPES.includes(order.type),
    "CSOB_PURCHASE_ORDER_INVALID",
    "ČSOB order type is unsupported.",
  )
  assertOptionalText({
    value: order.availability,
    maximumLength: 32,
    code: "CSOB_PURCHASE_ORDER_INVALID",
  })
  customerPaymentInvariant(
    order.delivery === undefined ||
      CSOB_ORDER_DELIVERIES.includes(order.delivery),
    "CSOB_PURCHASE_ORDER_INVALID",
    "ČSOB order delivery is unsupported.",
  )
  customerPaymentInvariant(
    order.deliveryMode === undefined ||
      CSOB_ORDER_DELIVERY_MODES.includes(order.deliveryMode),
    "CSOB_PURCHASE_ORDER_INVALID",
    "ČSOB order delivery mode is unsupported.",
  )
  assertOptionalText({
    value: order.deliveryEmail,
    maximumLength: 100,
    code: "CSOB_PURCHASE_ORDER_INVALID",
    pattern: EMAIL_PATTERN,
  })
  assertAddress(order.billing)
  assertAddress(order.shipping)
  if (order.shippingAddedAt !== undefined) {
    customerPaymentInvariant(
      ISO_DATE_TIME_PATTERN.test(order.shippingAddedAt) ||
        isCsobDateTime(order.shippingAddedAt),
      "CSOB_PURCHASE_ORDER_INVALID",
      "ČSOB shipping added timestamp is invalid.",
    )
  }
  if (order.giftCards) {
    customerPaymentInvariant(
      order.giftCards.totalAmount === undefined ||
        (Number.isSafeInteger(order.giftCards.totalAmount) &&
          order.giftCards.totalAmount >= 0),
      "CSOB_PURCHASE_ORDER_INVALID",
      "ČSOB gift-card amount is invalid.",
    )
    assertOptionalText({
      value: order.giftCards.currency,
      maximumLength: 3,
      code: "CSOB_PURCHASE_ORDER_INVALID",
    })
    assertOptionalCount(order.giftCards.quantity, "CSOB_PURCHASE_ORDER_INVALID")
  }
}

export const flattenCsobPurchaseAddress = (
  address: CsobPurchaseAddress | undefined,
): SigningValue[] => {
  if (!address) {
    return []
  }
  return [
    address.address1,
    address.address2,
    address.address3,
    address.city,
    address.zip,
    address.state,
    address.country,
  ]
}

export const flattenCsobPurchaseCustomer = (
  customer: CsobPurchaseCustomer | undefined,
): SigningValue[] => {
  if (!customer) {
    return []
  }
  return [
    customer.name,
    customer.email,
    customer.homePhone,
    customer.workPhone,
    customer.mobilePhone,
    customer.account?.createdAt,
    customer.account?.changedAt,
    customer.account?.changedPwdAt,
    customer.account?.orderHistory,
    customer.account?.paymentsDay,
    customer.account?.paymentsYear,
    customer.account?.oneclickAdds,
    customer.account?.suspicious,
    customer.login?.auth,
    customer.login?.authAt,
    customer.login?.authData,
  ]
}

export const flattenCsobPurchaseOrder = (
  order: CsobPurchaseOrder | undefined,
): SigningValue[] => {
  if (!order) {
    return []
  }
  return [
    order.type,
    order.availability,
    order.delivery,
    order.deliveryMode,
    order.deliveryEmail,
    order.nameMatch,
    order.addressMatch,
    ...flattenCsobPurchaseAddress(order.billing),
    ...flattenCsobPurchaseAddress(order.shipping),
    order.shippingAddedAt,
    order.reorder,
    order.giftCards?.totalAmount,
    order.giftCards?.currency,
    order.giftCards?.quantity,
  ]
}
