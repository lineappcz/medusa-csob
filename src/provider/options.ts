import { createPrivateKey, createPublicKey } from "node:crypto"
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs"
import { isAbsolute, resolve } from "node:path"

import { MedusaError } from "@medusajs/framework/utils"

import {
  NodeRsaSha256CsobSignatureService,
  type CsobEnvironment,
  type CsobSignatureService,
  type CustomerPaymentHttpClient,
} from "../client"

const MAX_KEY_BYTES = 64 * 1024

export type CsobPaymentProviderOptions = {
  environment: CsobEnvironment
  merchant_id: string
  merchant_private_key_path?: string
  merchant_private_key_base64?: string
  gateway_public_key_path?: string
  gateway_public_key_base64?: string
  allowed_return_origins: string[] | string
  allow_insecure_local_return_url?: boolean
  timeout_ms?: number
  maintenance_mode?: boolean
  maintenance_reference?: string
  /** Test seam; never configured from environment in production. */
  http_client?: CustomerPaymentHttpClient
  /** Test seam; never configured from environment in production. */
  clock?: () => Date
}

export type ResolvedCsobPaymentProviderOptions = Omit<
  CsobPaymentProviderOptions,
  "allowed_return_origins"
> & {
  allowedReturnOrigins: ReadonlySet<string>
}

const configurationError = (message: string): never => {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

const exactlyOne = (left?: string, right?: string): boolean =>
  Boolean(left) !== Boolean(right)

const decodeKey = ({
  path,
  base64,
  label,
  enforceProductionPrivateKeyPolicy = false,
}: {
  path?: string
  base64?: string
  label: string
  enforceProductionPrivateKeyPolicy?: boolean
}): Buffer => {
  if (!exactlyOne(path, base64)) {
    return configurationError(
      `${label} must be configured from exactly one path or base64 value.`,
    )
  }

  let bytes: Buffer
  if (path) {
    const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path)
    let descriptor: number | undefined
    try {
      descriptor = openSync(
        absolutePath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      )
      const metadata = fstatSync(descriptor)

      if (enforceProductionPrivateKeyPolicy) {
        if (!metadata.isFile()) {
          return configurationError(
            `${label} must be a regular file in production.`,
          )
        }

        const permissionBits = metadata.mode & 0o777
        if (permissionBits !== 0o400 && permissionBits !== 0o600) {
          return configurationError(
            `${label} must use mode 0400 or 0600 in production.`,
          )
        }

        if (
          typeof process.getuid === "function" &&
          metadata.uid !== process.getuid()
        ) {
          return configurationError(
            `${label} must be owned by the runtime user in production.`,
          )
        }
      }

      bytes = readFileSync(descriptor)
    } catch (error) {
      if (MedusaError.isMedusaError(error)) {
        throw error
      }
      return configurationError(`${label} cannot be read.`)
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor)
      }
    }
  } else {
    if (
      !base64 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        base64,
      )
    ) {
      return configurationError(`${label} is not canonical base64.`)
    }
    bytes = Buffer.from(base64, "base64")
    if (bytes.toString("base64") !== base64) {
      return configurationError(`${label} is not canonical base64.`)
    }
  }

  if (bytes.length === 0 || bytes.length > MAX_KEY_BYTES) {
    return configurationError(`${label} has an invalid size.`)
  }
  return bytes
}

const normalizeOrigin = ({
  value,
  environment,
  allowInsecureLocalReturnUrl,
}: {
  value: string
  environment: CsobEnvironment
  allowInsecureLocalReturnUrl: boolean
}): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return configurationError("ČSOB allowed return origin is invalid.")
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  const localHttp =
    environment === "sandbox" &&
    allowInsecureLocalReturnUrl &&
    loopback &&
    url.protocol === "http:"
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return configurationError(
      "ČSOB allowed return origins must be HTTPS origins without paths; sandbox loopback HTTP requires an explicit opt-in.",
    )
  }
  return url.origin
}

export const resolveCsobPaymentProviderOptions = (
  options: CsobPaymentProviderOptions,
): ResolvedCsobPaymentProviderOptions => {
  if (
    !options ||
    !["sandbox", "production"].includes(options.environment) ||
    typeof options.merchant_id !== "string" ||
    options.merchant_id.length === 0
  ) {
    return configurationError("ČSOB payment provider options are incomplete.")
  }
  if (options.maintenance_mode === true) {
    if (
      typeof options.maintenance_reference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/.test(
        options.maintenance_reference.trim(),
      )
    ) {
      return configurationError(
        "ČSOB maintenance mode requires an auditable reference.",
      )
    }
  } else if (options.maintenance_reference) {
    return configurationError(
      "ČSOB maintenance reference requires maintenance mode.",
    )
  }
  if (
    options.allow_insecure_local_return_url === true &&
    options.environment !== "sandbox"
  ) {
    return configurationError(
      "Insecure local ČSOB return URLs are allowed only in sandbox.",
    )
  }
  if (
    options.timeout_ms !== undefined &&
    (!Number.isInteger(options.timeout_ms) ||
      options.timeout_ms < 500 ||
      options.timeout_ms > 30_000)
  ) {
    return configurationError("ČSOB timeout must be between 500 and 30000 ms.")
  }
  if (
    !exactlyOne(
      options.merchant_private_key_path,
      options.merchant_private_key_base64,
    ) ||
    !exactlyOne(
      options.gateway_public_key_path,
      options.gateway_public_key_base64,
    )
  ) {
    return configurationError(
      "ČSOB signing and verification keys must each use exactly one source.",
    )
  }

  const origins = Array.isArray(options.allowed_return_origins)
    ? options.allowed_return_origins
    : String(options.allowed_return_origins ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
  if (!origins.length) {
    return configurationError("At least one ČSOB return origin is required.")
  }
  const allowedReturnOrigins = new Set(
    origins.map((value) =>
      normalizeOrigin({
        value,
        environment: options.environment,
        allowInsecureLocalReturnUrl:
          options.allow_insecure_local_return_url === true,
      }),
    ),
  )

  return { ...options, allowedReturnOrigins }
}

export const createCsobSignatureService = (
  options: ResolvedCsobPaymentProviderOptions,
): CsobSignatureService => {
  const privateKeyBytes = decodeKey({
    path: options.merchant_private_key_path,
    base64: options.merchant_private_key_base64,
    label: "ČSOB merchant private key",
    enforceProductionPrivateKeyPolicy:
      options.environment === "production" &&
      Boolean(options.merchant_private_key_path),
  })
  const publicKeyBytes = decodeKey({
    path: options.gateway_public_key_path,
    base64: options.gateway_public_key_base64,
    label: "ČSOB gateway public key",
  })

  try {
    return new NodeRsaSha256CsobSignatureService(
      createPrivateKey(privateKeyBytes),
      createPublicKey(publicKeyBytes),
    )
  } catch {
    return configurationError("ČSOB RSA key material is invalid.")
  }
}

export const assertCsobReturnUrlAllowed = (
  value: string,
  options: ResolvedCsobPaymentProviderOptions,
): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ČSOB return URL is invalid.",
    )
  }
  if (!options.allowedReturnOrigins.has(url.origin)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ČSOB return URL origin is not allowed.",
    )
  }
  return url.toString()
}
