export const CSOB_EAPI_VERSION = "1.9" as const

export const CSOB_EAPI_1_9_ENDPOINTS = {
  sandbox: "https://iapi.iplatebnibrana.csob.cz/api/v1.9",
  production: "https://api.platebnibrana.csob.cz/api/v1.9",
} as const

export type CsobEnvironment = keyof typeof CSOB_EAPI_1_9_ENDPOINTS

export const CSOB_CURRENCIES = [
  "CZK",
  "EUR",
  "USD",
  "GBP",
  "HUF",
  "PLN",
  "RON",
  "NOK",
  "SEK",
] as const

export type CsobCurrency = (typeof CSOB_CURRENCIES)[number]

export const CSOB_LANGUAGES = [
  "cs",
  "en",
  "de",
  "fr",
  "hu",
  "it",
  "ja",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "es",
  "tr",
  "vi",
  "hr",
  "sl",
  "sv",
] as const

export type CsobLanguage = (typeof CSOB_LANGUAGES)[number]

export const CSOB_PAY_OPERATIONS = [
  "payment",
  "oneclickPayment",
  "customPayment",
] as const

export type CsobPayOperation = (typeof CSOB_PAY_OPERATIONS)[number]

export const CSOB_PAY_METHODS = ["card", "card#LVP"] as const

export type CsobPayMethod = (typeof CSOB_PAY_METHODS)[number]

export const CSOB_CHECKOUT_METHODS = [
  "card",
  "custom",
  "button",
  "oneclick",
  "applepay",
  "googlepay",
  "mallpay",
  "loan",
] as const

export type CsobCheckoutMethod = (typeof CSOB_CHECKOUT_METHODS)[number]

export const CSOB_CUSTOM_PAYMENT_URLS = {
  sandbox: "https://iplatebnibrana.csob.cz/zaplat",
  production: "https://platebnibrana.csob.cz/zaplat",
} as const

export const CSOB_RETURN_METHODS = ["POST", "GET"] as const

export type CsobReturnMethod = (typeof CSOB_RETURN_METHODS)[number]
