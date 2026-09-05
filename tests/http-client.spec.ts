import { FetchCustomerPaymentHttpClient } from "../src/client/http-client"
describe("signed payment HTTP transport", () => {
  const request = {
    url: "https://bank.example.com/status",
    method: "GET" as const,
    headers: {},
    timeoutMs: 10,
  }
  it("normalizes headers and forbids redirecting credentials/signatures", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { "Content-Type": "application/json" },
      }),
    )
    const result = await new FetchCustomerPaymentHttpClient(fetchImpl).send(
      request,
    )
    expect(result).toMatchObject({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    })
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      method: "GET",
    })
  })
  it("aborts timed out requests without retrying a bank write", async () => {
    const fetchImpl = jest.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          )
        }),
    )
    await expect(
      new FetchCustomerPaymentHttpClient(fetchImpl).send({
        ...request,
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("aborted")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
