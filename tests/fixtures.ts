import type {
  CsobRequestSigner,
  CsobResponseVerifier,
  CustomerPaymentHttpClient,
  CustomerPaymentHttpRequest,
  CustomerPaymentHttpResponse,
  InitializeCustomerPaymentCommand,
} from "../src/client"

export const FIXED_DATE = new Date("2026-08-31T10:34:56.000Z")
export const FIXED_CSOB_DATE_TIME = "20260831123456"
export const PAY_ID = "ff41e84b7e33@HA"
export const VALID_SIGNATURE = "c2ln"

export const jsonResponse = (
  overrides: Record<string, unknown> = {},
): CustomerPaymentHttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    payId: PAY_ID,
    dttm: FIXED_CSOB_DATE_TIME,
    resultCode: 0,
    resultMessage: "OK",
    paymentStatus: 1,
    signature: VALID_SIGNATURE,
    ...overrides,
  }),
})

export class QueueHttpClient implements CustomerPaymentHttpClient {
  readonly requests: CustomerPaymentHttpRequest[] = []

  constructor(
    private readonly responses: Array<CustomerPaymentHttpResponse | Error> = [],
  ) {}

  async send(
    request: CustomerPaymentHttpRequest,
  ): Promise<CustomerPaymentHttpResponse> {
    this.requests.push(request)
    const response = this.responses.shift()
    if (response instanceof Error) {
      throw response
    }
    if (!response) {
      throw new Error("No fake HTTP response configured")
    }
    return response
  }
}

export class RecordingSignatureBoundary
  implements CsobRequestSigner, CsobResponseVerifier
{
  readonly signedTexts: string[] = []
  readonly verifiedTexts: Array<{ text: string; signature: string }> = []

  constructor(private readonly verificationResult = true) {}

  async sign(textToSign: string): Promise<string> {
    this.signedTexts.push(textToSign)
    return VALID_SIGNATURE
  }

  async verify(textToSign: string, signature: string): Promise<boolean> {
    this.verifiedTexts.push({ text: textToSign, signature })
    return this.verificationResult
  }
}

export const initializeCommand = (
  overrides: Partial<InitializeCustomerPaymentCommand> = {},
): InitializeCustomerPaymentCommand => ({
  amount: { amountMinor: "123400", currencyCode: "CZK" },
  lines: [
    {
      name: "Tiskoviny",
      quantity: 1,
      amountMinor: "120000",
    },
    {
      name: "Doprava",
      quantity: 1,
      amountMinor: "3400",
      description: "DPD",
    },
  ],
  returnUrl: "https://example-store.cz/checkout/payment/return",
  captureMode: "automatic",
  idempotencyKey: "checkout.cart_01.revision_1",
  correlationId: "cart_01",
  orderReference: "5547",
  customerId: "customer_01",
  language: "cs",
  expiresInSeconds: 1_800,
  ...overrides,
})
