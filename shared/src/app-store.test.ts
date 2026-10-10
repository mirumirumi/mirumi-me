import { afterEach, describe, expect, test, vi } from "vitest"

import {
  type AppStoreApp,
  type AppStoreCache,
  fetchAppStoreApp,
  parseAppStoreUrl,
  resolveAppStoreApp,
} from "./app-store"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("app store", () => {
  const app: AppStoreApp = {
    id: "1234567890",
    name: "アプリ",
    developer: "開発元",
    price: "無料",
    artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/icon/512x512bb.jpg",
  }

  class MemoryCache implements AppStoreCache {
    values = new Map<string, string>()

    async get(key: string): Promise<string | null> {
      return this.values.get(key) ?? null
    }

    async put(key: string, value: string): Promise<void> {
      this.values.set(key, value)
    }
  }

  describe("parseAppStoreUrl", () => {
    test("App Store の URL から ID と国を読み、国がなければ jp にする", () => {
      expect(parseAppStoreUrl("https://apps.apple.com/jp/app/some-app/id1234567890")).toEqual({
        id: "1234567890",
        country: "jp",
      })
      expect(parseAppStoreUrl("https://apps.apple.com/us/app/id42")).toEqual({
        id: "42",
        country: "us",
      })
      expect(parseAppStoreUrl("https://apps.apple.com/app/some-app/id42?l=en")).toEqual({
        id: "42",
        country: "jp",
      })
      expect(parseAppStoreUrl("https://itunes.apple.com/jp/app/id42?mt=8")).toEqual({
        id: "42",
        country: "jp",
      })
    })

    test("App Store 以外の URL は null にする", () => {
      expect(parseAppStoreUrl("https://play.google.com/store/apps/details?id=x")).toEqual(null)
      expect(parseAppStoreUrl("https://apps.apple.com/jp/app/no-id")).toEqual(null)
      expect(parseAppStoreUrl("not a url")).toEqual(null)
    })
  })

  describe("fetchAppStoreApp", () => {
    test("iTunes の lookup から名前、開発元、価格、512 px のアイコンを取る", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          resultCount: 1,
          results: [
            {
              trackId: 1234567890,
              trackName: "アプリ",
              artistName: "開発元",
              formattedPrice: "無料",
              artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/icon/100x100bb.jpg",
              artworkUrl512: "https://is1-ssl.mzstatic.com/image/thumb/icon/512x512bb.jpg",
            },
          ],
        }),
      )
      vi.stubGlobal("fetch", fetcher)

      expect(await fetchAppStoreApp("1234567890", "jp")).toEqual(app)
      expect(String(fetcher.mock.calls[0]?.[0])).toEqual(
        "https://itunes.apple.com/lookup?id=1234567890&country=jp",
      )
    })

    test("見つからなければ例外にする", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ resultCount: 0, results: [] })),
      )

      await expect(fetchAppStoreApp("1", "jp")).rejects.toThrow(
        "App Store にアプリが見つかりません",
      )
    })
  })

  describe("resolveAppStoreApp", () => {
    const url = "https://apps.apple.com/jp/app/some-app/id1234567890"

    test("7 日のあいだは cache を使い、過ぎたら引き直して cache する", async () => {
      const cache = new MemoryCache()
      const lookup = vi.fn(async () => app)

      expect(
        await resolveAppStoreApp(url, cache, { lookup, now: "2026-10-01T00:00:00.000Z" }),
      ).toEqual(app)
      expect(
        await resolveAppStoreApp(url, cache, { lookup, now: "2026-10-07T00:00:00.000Z" }),
      ).toEqual(app)
      expect(lookup).toHaveBeenCalledTimes(1)
      expect(
        await resolveAppStoreApp(url, cache, { lookup, now: "2026-10-09T00:00:00.000Z" }),
      ).toEqual(app)
      expect(lookup).toHaveBeenCalledTimes(2)
      expect(lookup).toHaveBeenCalledWith("1234567890", "jp")
      expect([...cache.values.keys()]).toEqual(["app-store:v1:jp:1234567890"])
    })

    test("引けないときは古い cache を使い、cache もなければ例外にする", async () => {
      const cache = new MemoryCache()
      await resolveAppStoreApp(url, cache, {
        lookup: async () => app,
        now: "2026-10-01T00:00:00.000Z",
      })
      const failing = async (): Promise<AppStoreApp> => {
        throw Error("iTunes が落ちた")
      }

      expect(
        await resolveAppStoreApp(url, cache, { lookup: failing, now: "2026-12-01T00:00:00.000Z" }),
      ).toEqual(app)
      await expect(
        resolveAppStoreApp(url, new MemoryCache(), {
          lookup: failing,
          now: "2026-12-01T00:00:00.000Z",
        }),
      ).rejects.toThrow("iTunes が落ちた")
    })

    test("App Store の URL でなければ例外にする", async () => {
      await expect(resolveAppStoreApp("https://example.com/", new MemoryCache())).rejects.toThrow(
        "App Store の URL ではありません",
      )
    })
  })
})
