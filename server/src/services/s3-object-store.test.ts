import { describe, expect, test, vi } from "vitest"

import { SignedS3ObjectStore } from "./s3-object-store"

describe("SignedS3ObjectStore", () => {
  const credentials = { accessKeyId: "AKIA", secretAccessKey: "secret" }
  const createStore = (fetcher: ReturnType<typeof vi.fn>) => {
    return new SignedS3ObjectStore({
      fetcher: fetcher as unknown as typeof fetch,
      region: "ap-northeast-1",
      bucket: "mirumime-dev-backup",
      credentials,
    })
  }
  const requestOf = (fetcher: ReturnType<typeof vi.fn>) => {
    const [url, init] = fetcher.mock.calls[0] as [
      URL,
      RequestInit & { headers: Record<string, string> },
    ]

    return { url, init }
  }

  describe("get", () => {
    test("署名付き GET で bytes を返し、404 は null にする", async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("body"))
        .mockResolvedValueOnce(new Response("", { status: 404 }))
      const store = createStore(fetcher)

      expect(await store.get("_internal/publish-index-v1.json")).toEqual(
        new TextEncoder().encode("body"),
      )
      expect(await store.get("missing")).toEqual(null)
      const { url, init } = requestOf(fetcher)
      expect(url.href).toEqual(
        "https://mirumime-dev-backup.s3.ap-northeast-1.amazonaws.com/_internal/publish-index-v1.json",
      )
      expect(init.method).toEqual("GET")
      expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA\//)
    })

    test("404 以外の失敗は例外にする", async () => {
      const store = createStore(vi.fn().mockResolvedValue(new Response("", { status: 403 })))

      await expect(store.get("key")).rejects.toThrowError("403 key")
    })
  })

  describe("put", () => {
    test("storage class と base64 の sha256 checksum を署名対象 header に含めて PUT する", async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(""))
      const store = createStore(fetcher)
      const body = new TextEncoder().encode("{}")
      // sha256("{}") の hex
      const sha256 = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"

      await store.put("v1/x/manifest.json", body, {
        contentType: "application/json; charset=utf-8",
        sha256,
        storageClass: "DEEP_ARCHIVE",
      })

      const { url, init } = requestOf(fetcher)
      expect(url.pathname).toEqual("/v1/x/manifest.json")
      expect(init.method).toEqual("PUT")
      expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(body)
      expect(init.headers["content-type"]).toEqual("application/json; charset=utf-8")
      expect(init.headers["x-amz-storage-class"]).toEqual("DEEP_ARCHIVE")
      expect(init.headers["x-amz-checksum-sha256"]).toEqual(
        "RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=",
      )
      expect(init.headers["x-amz-content-sha256"]).toEqual(sha256)
      expect(init.headers.authorization).toContain(
        "SignedHeaders=content-type;host;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
      )
    })

    test("失敗した PUT は例外にする", async () => {
      const store = createStore(vi.fn().mockResolvedValue(new Response("", { status: 500 })))

      await expect(
        store.put("key", new Uint8Array(), {
          contentType: "application/gzip",
          sha256: "0".repeat(64),
          storageClass: "STANDARD",
        }),
      ).rejects.toThrowError("500 key")
    })
  })
})
