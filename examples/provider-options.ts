import type { CsobProviderOptions } from "../src/provider/service"

// Copy into your app; change the import to @lineapp/medusa-csob.
export const options: CsobProviderOptions = {
  environment: "sandbox",
  merchant_id: process.env.CSOB_MERCHANT_ID!,
  merchant_private_key_base64: process.env.CSOB_PRIVATE_KEY_BASE64!,
  gateway_public_key_base64: process.env.CSOB_GATEWAY_KEY_BASE64!,
  allowed_return_origins: [process.env.STOREFRONT_ORIGIN!],
  return_url: `${process.env.STOREFRONT_ORIGIN}/payment/return`,
  redis_url: process.env.PAYMENT_OPERATION_REDIS_URL!,
  namespace: process.env.PAYMENT_OPERATION_NAMESPACE!,
  capture_mode: "automatic",
  description: "Order",
}
