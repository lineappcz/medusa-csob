export type CustomerPaymentHttpRequest = {
  url: string
  method: "GET" | "POST" | "PUT"
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}

export type CustomerPaymentHttpResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

export interface CustomerPaymentHttpClient {
  send(
    request: CustomerPaymentHttpRequest,
  ): Promise<CustomerPaymentHttpResponse>
}

export class FetchCustomerPaymentHttpClient implements CustomerPaymentHttpClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(
    request: CustomerPaymentHttpRequest,
  ): Promise<CustomerPaymentHttpResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)

    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        redirect: "error",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })

      return {
        status: response.status,
        headers,
        body: await response.text(),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
