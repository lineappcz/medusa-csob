import { customerPaymentInvariant } from "./errors"

type SigningValue = string | number | boolean | undefined

const SAFE_TEXT_PATTERN = /^\S(?:.*\S)?$/u
const COLOR_DEPTHS = new Set([1, 4, 8, 15, 16, 24, 32, 48])
const CHALLENGE_WINDOW_SIZES = new Set(["01", "02", "03", "04", "05"])

export type CsobAuthEndpoint = {
  url: string
  method?: "GET" | "POST"
  vars?: Record<string, string>
}

export type CsobSdkInit = {
  directoryServerID: string
  schemeId: string
  messageVersion: string
}

export type CsobSdkChallenge = {
  threeDSServerTransID: string
  acsReferenceNumber: string
  acsTransID: string
  acsSignedContent: string
}

export type CsobBrowserFingerprint = {
  userAgent: string
  acceptHeader: string
  language: string
  javascriptEnabled: boolean
  colorDepth?: number
  screenHeight?: number
  screenWidth?: number
  timezone?: number
  javaEnabled?: boolean
  challengeWindowSize?: string
}

export type CsobSdkFingerprint = {
  appID: string
  encData: string
  ephemPubKey: string
  maxTimeout?: number
  referenceNumber: string
  transID: string
}

export type CsobAuthFingerprint = {
  browser?: CsobBrowserFingerprint
  sdk?: CsobSdkFingerprint
}

export type CsobPaymentActions = {
  fingerprint?: {
    browserInit?: CsobAuthEndpoint
    sdkInit?: CsobSdkInit
  }
  authenticate?: {
    browserChallenge?: CsobAuthEndpoint
    sdkChallenge?: CsobSdkChallenge
  }
}

export type CsobRedirect = {
  method: "GET" | "POST"
  url: string
  params?: Record<string, string>
}

const assertText = (value: string, maximumLength: number, code: string) => {
  customerPaymentInvariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximumLength &&
      SAFE_TEXT_PATTERN.test(value),
    code,
    "ČSOB authentication data contains an invalid text field.",
  )
}

export const assertCsobClientIp = (value: string): void => {
  customerPaymentInvariant(
    typeof value === "string" && (isIpv4(value) || isIpv6(value)),
    "CSOB_CLIENT_IP_INVALID",
    "ČSOB client IP must be an IPv4 or IPv6 address.",
  )
}

const isIpv4 = (value: string): boolean => {
  const parts = value.split(".")
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255,
    )
  )
}

const isIpv6 = (value: string): boolean => {
  if (value.includes("%") || value.includes("/")) {
    return false
  }
  try {
    return new URL(`http://[${value}]`).hostname === `[${value}]`
  } catch {
    return false
  }
}

export const assertCsobAuthFingerprint = (
  fingerprint: CsobAuthFingerprint,
): void => {
  const hasBrowser = fingerprint.browser !== undefined
  const hasSdk = fingerprint.sdk !== undefined
  customerPaymentInvariant(
    hasBrowser !== hasSdk,
    "CSOB_FINGERPRINT_INVALID",
    "ČSOB fingerprint must contain either browser or SDK data.",
  )
  if (fingerprint.browser) {
    const browser = fingerprint.browser
    assertText(browser.userAgent, 2048, "CSOB_FINGERPRINT_INVALID")
    assertText(browser.acceptHeader, 2048, "CSOB_FINGERPRINT_INVALID")
    assertText(browser.language, 8, "CSOB_FINGERPRINT_INVALID")
    if (browser.javascriptEnabled) {
      customerPaymentInvariant(
        browser.colorDepth !== undefined &&
          COLOR_DEPTHS.has(browser.colorDepth) &&
          Number.isSafeInteger(browser.screenHeight) &&
          (browser.screenHeight ?? 0) > 0 &&
          Number.isSafeInteger(browser.screenWidth) &&
          (browser.screenWidth ?? 0) > 0 &&
          Number.isSafeInteger(browser.timezone) &&
          typeof browser.javaEnabled === "boolean",
        "CSOB_FINGERPRINT_INVALID",
        "ČSOB browser fingerprint is missing required JavaScript fields.",
      )
    }
    customerPaymentInvariant(
      browser.challengeWindowSize === undefined ||
        CHALLENGE_WINDOW_SIZES.has(browser.challengeWindowSize),
      "CSOB_FINGERPRINT_INVALID",
      "ČSOB challenge window size is unsupported.",
    )
  }
  if (fingerprint.sdk) {
    const sdk = fingerprint.sdk
    assertText(sdk.appID, 36, "CSOB_FINGERPRINT_INVALID")
    assertText(sdk.encData, 64_000, "CSOB_FINGERPRINT_INVALID")
    assertText(sdk.ephemPubKey, 4096, "CSOB_FINGERPRINT_INVALID")
    assertText(sdk.referenceNumber, 32, "CSOB_FINGERPRINT_INVALID")
    assertText(sdk.transID, 36, "CSOB_FINGERPRINT_INVALID")
    customerPaymentInvariant(
      sdk.maxTimeout === undefined ||
        (Number.isSafeInteger(sdk.maxTimeout) && sdk.maxTimeout >= 5),
      "CSOB_FINGERPRINT_INVALID",
      "ČSOB SDK fingerprint timeout must be at least 5 minutes.",
    )
  }
}

const flattenEndpoint = (
  endpoint: CsobAuthEndpoint | undefined,
): SigningValue[] => {
  if (!endpoint) {
    return []
  }
  return [
    endpoint.url,
    endpoint.method,
    ...(endpoint.vars ? Object.values(endpoint.vars) : []),
  ]
}

export const flattenCsobPaymentActions = (
  actions: CsobPaymentActions | undefined,
): SigningValue[] => {
  if (!actions) {
    return []
  }
  return [
    ...flattenEndpoint(actions.fingerprint?.browserInit),
    actions.fingerprint?.sdkInit?.directoryServerID,
    actions.fingerprint?.sdkInit?.schemeId,
    actions.fingerprint?.sdkInit?.messageVersion,
    ...flattenEndpoint(actions.authenticate?.browserChallenge),
    actions.authenticate?.sdkChallenge?.threeDSServerTransID,
    actions.authenticate?.sdkChallenge?.acsReferenceNumber,
    actions.authenticate?.sdkChallenge?.acsTransID,
    actions.authenticate?.sdkChallenge?.acsSignedContent,
  ]
}

export const flattenCsobAuthFingerprint = (
  fingerprint: CsobAuthFingerprint | undefined,
): SigningValue[] => {
  if (!fingerprint) {
    return []
  }
  if (fingerprint.browser) {
    const browser = fingerprint.browser
    return [
      browser.userAgent,
      browser.acceptHeader,
      browser.language,
      browser.javascriptEnabled,
      browser.colorDepth,
      browser.screenHeight,
      browser.screenWidth,
      browser.timezone,
      browser.javaEnabled,
      browser.challengeWindowSize,
    ]
  }
  if (!fingerprint.sdk) {
    return []
  }
  const sdk = fingerprint.sdk
  return [
    sdk.appID,
    sdk.encData,
    sdk.ephemPubKey,
    sdk.maxTimeout,
    sdk.referenceNumber,
    sdk.transID,
  ]
}

export const flattenCsobRedirect = (
  redirect: CsobRedirect | undefined,
): SigningValue[] => {
  if (!redirect) {
    return []
  }
  return [
    redirect.method,
    redirect.url,
    ...(redirect.params ? Object.values(redirect.params) : []),
  ]
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value === undefined) {
    return undefined
  }
  customerPaymentInvariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "CSOB_RESPONSE_ACTIONS_INVALID",
    "ČSOB returned invalid payment actions.",
    "UNKNOWN",
  )
  return value as Record<string, unknown>
}

const optionalString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!record || record[key] === undefined) {
    return undefined
  }
  customerPaymentInvariant(
    typeof record[key] === "string" && record[key].length > 0,
    "CSOB_RESPONSE_ACTIONS_INVALID",
    "ČSOB returned an invalid payment action field.",
    "UNKNOWN",
  )
  return record[key] as string
}

const parseEndpoint = (value: unknown): CsobAuthEndpoint | undefined => {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const url = optionalString(record, "url")
  customerPaymentInvariant(
    url !== undefined,
    "CSOB_RESPONSE_ACTIONS_INVALID",
    "ČSOB returned an action endpoint without a URL.",
    "UNKNOWN",
  )
  const method = optionalString(record, "method")
  customerPaymentInvariant(
    method === undefined || method === "GET" || method === "POST",
    "CSOB_RESPONSE_ACTIONS_INVALID",
    "ČSOB returned an unsupported action method.",
    "UNKNOWN",
  )
  let vars: Record<string, string> | undefined
  if (record.vars !== undefined) {
    const varsRecord = asRecord(record.vars)
    vars = {}
    for (const [key, entry] of Object.entries(varsRecord ?? {})) {
      customerPaymentInvariant(
        typeof entry === "string",
        "CSOB_RESPONSE_ACTIONS_INVALID",
        "ČSOB returned invalid action variables.",
        "UNKNOWN",
      )
      vars[key] = entry
    }
  }
  return {
    url,
    ...(method ? { method } : {}),
    ...(vars ? { vars } : {}),
  }
}

export const parseCsobPaymentActions = (
  value: unknown,
): CsobPaymentActions | undefined => {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const fingerprint = asRecord(record.fingerprint)
  const authenticate = asRecord(record.authenticate)
  const sdkInit = asRecord(fingerprint?.sdkInit)
  const sdkChallenge = asRecord(authenticate?.sdkChallenge)
  const actions: CsobPaymentActions = {}
  if (fingerprint) {
    const browserInit = parseEndpoint(fingerprint.browserInit)
    actions.fingerprint = {
      ...(browserInit ? { browserInit } : {}),
      ...(sdkInit
        ? {
            sdkInit: {
              directoryServerID: optionalString(sdkInit, "directoryServerID")!,
              schemeId: optionalString(sdkInit, "schemeId")!,
              messageVersion: optionalString(sdkInit, "messageVersion")!,
            },
          }
        : {}),
    }
  }
  if (authenticate) {
    const browserChallenge = parseEndpoint(authenticate.browserChallenge)
    actions.authenticate = {
      ...(browserChallenge ? { browserChallenge } : {}),
      ...(sdkChallenge
        ? {
            sdkChallenge: {
              threeDSServerTransID: optionalString(
                sdkChallenge,
                "threeDSServerTransID",
              )!,
              acsReferenceNumber: optionalString(
                sdkChallenge,
                "acsReferenceNumber",
              )!,
              acsTransID: optionalString(sdkChallenge, "acsTransID")!,
              acsSignedContent: optionalString(
                sdkChallenge,
                "acsSignedContent",
              )!,
            },
          }
        : {}),
    }
  }
  return actions
}

export const parseCsobRedirect = (value: unknown): CsobRedirect | undefined => {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const method = optionalString(record, "method")
  const url = optionalString(record, "url")
  customerPaymentInvariant(
    (method === "GET" || method === "POST") && url !== undefined,
    "CSOB_RESPONSE_REDIRECT_INVALID",
    "ČSOB returned an invalid redirect.",
    "UNKNOWN",
  )
  let params: Record<string, string> | undefined
  if (record.params !== undefined) {
    const paramsRecord = asRecord(record.params)
    params = {}
    for (const [key, entry] of Object.entries(paramsRecord ?? {})) {
      customerPaymentInvariant(
        typeof entry === "string",
        "CSOB_RESPONSE_REDIRECT_INVALID",
        "ČSOB returned invalid redirect parameters.",
        "UNKNOWN",
      )
      params[key] = entry
    }
  }
  return { method, url, ...(params ? { params } : {}) }
}
