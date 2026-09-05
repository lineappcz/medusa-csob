import { generateKeyPairSync } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isCanonicalBase64 } from "../src/client"
import {
  assertCsobReturnUrlAllowed,
  createCsobSignatureService,
  resolveCsobPaymentProviderOptions,
  type CsobPaymentProviderOptions,
} from "../src/provider"

const keyMaterial = () => {
  const merchant = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  const gateway = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  return {
    merchantPrivateKeyPem: merchant.privateKey,
    merchantPrivateKeyBase64: Buffer.from(merchant.privateKey).toString(
      "base64",
    ),
    gatewayPublicKeyPem: gateway.publicKey,
    gatewayPublicKeyBase64: Buffer.from(gateway.publicKey).toString("base64"),
  }
}

const validOptions = (
  overrides: Partial<CsobPaymentProviderOptions> = {},
): CsobPaymentProviderOptions => {
  const keys = keyMaterial()
  return {
    environment: "sandbox",
    merchant_id: "M1MIPS0000",
    merchant_private_key_base64: keys.merchantPrivateKeyBase64,
    gateway_public_key_base64: keys.gatewayPublicKeyBase64,
    allowed_return_origins: "http://localhost:8000",
    allow_insecure_local_return_url: true,
    timeout_ms: 10_000,
    ...overrides,
  }
}

describe("ČSOB payment provider options", () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    while (temporaryDirectories.length) {
      rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
    }
    jest.restoreAllMocks()
  })

  it("accepts an explicitly enabled sandbox loopback origin and valid RSA keys", async () => {
    const resolved = resolveCsobPaymentProviderOptions(validOptions())
    const signatures = createCsobSignatureService(resolved)

    expect(resolved.allowedReturnOrigins).toEqual(
      new Set(["http://localhost:8000"]),
    )
    expect(isCanonicalBase64(await signatures.sign("example-store"))).toBe(true)
  })

  it("requires an auditable reference only while maintenance mode is active", () => {
    expect(() =>
      resolveCsobPaymentProviderOptions(
        validOptions({ maintenance_mode: true }),
      ),
    ).toThrow("auditable reference")
    expect(() =>
      resolveCsobPaymentProviderOptions(
        validOptions({ maintenance_reference: "OPS-2026-0001" }),
      ),
    ).toThrow("requires maintenance mode")
    expect(
      resolveCsobPaymentProviderOptions(
        validOptions({
          maintenance_mode: true,
          maintenance_reference: "OPS-2026-0001",
        }),
      ),
    ).toMatchObject({
      maintenance_mode: true,
      maintenance_reference: "OPS-2026-0001",
    })
  })

  it("requires HTTPS in production even if a local exception is requested", () => {
    expect(() =>
      resolveCsobPaymentProviderOptions(
        validOptions({ environment: "production" }),
      ),
    ).toThrow("only in sandbox")
  })

  it("requires exactly one source for each key", () => {
    expect(() =>
      resolveCsobPaymentProviderOptions(
        validOptions({ merchant_private_key_path: "/tmp/duplicate.pem" }),
      ),
    ).toThrow("exactly one source")
  })

  it("allows return paths only on an exact allow-listed origin", () => {
    const resolved = resolveCsobPaymentProviderOptions(validOptions())
    expect(
      assertCsobReturnUrlAllowed(
        "http://localhost:8000/api/payment-return/csob?state=opaque",
        resolved,
      ),
    ).toBe("http://localhost:8000/api/payment-return/csob?state=opaque")
    expect(() =>
      assertCsobReturnUrlAllowed(
        "http://localhost.evil.test:8000/api/payment-return/csob",
        resolved,
      ),
    ).toThrow("not allowed")
  })

  it("accepts a production merchant private key owned by the runtime UID with mode 0600", () => {
    const keys = keyMaterial()
    const directory = mkdtempSync(join(tmpdir(), "example-store-csob-key-"))
    temporaryDirectories.push(directory)
    const privateKeyPath = join(directory, "merchant.pem")
    const publicKeyPath = join(directory, "gateway.pem")
    writeFileSync(privateKeyPath, keys.merchantPrivateKeyPem)
    writeFileSync(publicKeyPath, keys.gatewayPublicKeyPem)
    chmodSync(privateKeyPath, 0o600)
    chmodSync(publicKeyPath, 0o644)

    const resolved = resolveCsobPaymentProviderOptions(
      validOptions({
        environment: "production",
        merchant_private_key_base64: undefined,
        merchant_private_key_path: privateKeyPath,
        gateway_public_key_base64: undefined,
        gateway_public_key_path: publicKeyPath,
        allowed_return_origins: "https://example-store.cz",
        allow_insecure_local_return_url: false,
      }),
    )

    expect(() => createCsobSignatureService(resolved)).not.toThrow()
  })

  it("rejects a directory as the production merchant private key", () => {
    const keys = keyMaterial()
    const directory = mkdtempSync(join(tmpdir(), "example-store-csob-key-"))
    temporaryDirectories.push(directory)
    chmodSync(directory, 0o700)
    const resolved = resolveCsobPaymentProviderOptions(
      validOptions({
        environment: "production",
        merchant_private_key_base64: undefined,
        merchant_private_key_path: directory,
        gateway_public_key_base64: keys.gatewayPublicKeyBase64,
        allowed_return_origins: "https://example-store.cz",
        allow_insecure_local_return_url: false,
      }),
    )

    expect(() => createCsobSignatureService(resolved)).toThrow("regular file")
  })

  it("rejects group/other-readable production merchant key files", () => {
    const keys = keyMaterial()
    const directory = mkdtempSync(join(tmpdir(), "example-store-csob-key-"))
    temporaryDirectories.push(directory)
    const privateKeyPath = join(directory, "merchant.pem")
    writeFileSync(privateKeyPath, keys.merchantPrivateKeyPem)
    chmodSync(privateKeyPath, 0o644)
    const resolved = resolveCsobPaymentProviderOptions(
      validOptions({
        environment: "production",
        merchant_private_key_base64: undefined,
        merchant_private_key_path: privateKeyPath,
        gateway_public_key_base64: keys.gatewayPublicKeyBase64,
        allowed_return_origins: "https://example-store.cz",
        allow_insecure_local_return_url: false,
      }),
    )

    expect(() => createCsobSignatureService(resolved)).toThrow(
      "mode 0400 or 0600",
    )
  })

  it("rejects a production merchant key not owned by the runtime UID", () => {
    if (typeof process.getuid !== "function") return

    const keys = keyMaterial()
    const directory = mkdtempSync(join(tmpdir(), "example-store-csob-key-"))
    temporaryDirectories.push(directory)
    const privateKeyPath = join(directory, "merchant.pem")
    writeFileSync(privateKeyPath, keys.merchantPrivateKeyPem)
    chmodSync(privateKeyPath, 0o400)
    const actualUid = process.getuid()
    jest.spyOn(process, "getuid").mockReturnValue(actualUid + 1)
    const resolved = resolveCsobPaymentProviderOptions(
      validOptions({
        environment: "production",
        merchant_private_key_base64: undefined,
        merchant_private_key_path: privateKeyPath,
        gateway_public_key_base64: keys.gatewayPublicKeyBase64,
        allowed_return_origins: "https://example-store.cz",
        allow_insecure_local_return_url: false,
      }),
    )

    expect(() => createCsobSignatureService(resolved)).toThrow(
      "owned by the runtime user",
    )
  })
})
