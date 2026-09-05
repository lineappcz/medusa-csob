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
