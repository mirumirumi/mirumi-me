import { Hono } from "hono"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { HonoEnv } from "../lib/types"
import { type AccessTokenVerifier, createAccessMiddleware, verifyAccessToken } from "./access"

describe("createAccessMiddleware", () => {
  const env = {
    ACCESS_PREVIEW_AUD: "preview-audience",
    ACCESS_ADMIN_AUD: "admin-audience",
    ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  }

  const createApp = (verifier: AccessTokenVerifier) => {
    const app = new Hono<HonoEnv>()
    app.use("/admin/*", createAccessMiddleware("ACCESS_ADMIN_AUD", verifier))
    app.get("/admin/test", (c) => c.json({ ok: true }))

    return app
  }

  test("Access assertion header がなければ 401 にする", async () => {
    const verifier = vi.fn(async () => {})
    const response = await createApp(verifier).request("/admin/test", {}, env)

    expect(response.status).toEqual(401)
    expect(verifier).not.toHaveBeenCalled()
  })

  test("JWT の署名・issuer・audience が通った request だけを許可する", async () => {
    const verifier = vi.fn(async () => {})
    const response = await createApp(verifier).request(
      "/admin/test",
      { headers: { "Cf-Access-Jwt-Assertion": "signed-token" } },
      env,
    )

    expect(response.status).toEqual(200)
    expect(verifier).toHaveBeenCalledWith(
      "signed-token",
      "https://example.cloudflareaccess.com",
      "admin-audience",
    )
  })

  test("preview 用 token は admin route の audience 検証を通らない", async () => {
    const verifier = vi.fn<AccessTokenVerifier>(async (token, _teamDomain, audience) => {
      if (token !== `${audience}-token`) {
        throw Error("audience mismatch")
      }
    })
    const app = new Hono<HonoEnv>()
      .use("/preview", createAccessMiddleware("ACCESS_PREVIEW_AUD", verifier))
      .use("/admin/*", createAccessMiddleware("ACCESS_ADMIN_AUD", verifier))
      .get("/preview", (c) => c.text("preview"))
      .get("/admin/test", (c) => c.text("admin"))

    expect(
      (
        await app.request(
          "/preview",
          { headers: { "Cf-Access-Jwt-Assertion": "preview-audience-token" } },
          env,
        )
      ).status,
    ).toEqual(200)
    expect(
      (
        await app.request(
          "/admin/test",
          { headers: { "Cf-Access-Jwt-Assertion": "preview-audience-token" } },
          env,
        )
      ).status,
    ).toEqual(401)
    expect(
      (
        await app.request(
          "/admin/test",
          { headers: { "Cf-Access-Jwt-Assertion": "admin-audience-token" } },
          env,
        )
      ).status,
    ).toEqual(200)
  })

  test("JWT 検証失敗は詳細を返さず 401 にする", async () => {
    const verifier = vi.fn(async () => {
      throw Error("signature detail")
    })
    const response = await createApp(verifier).request(
      "/admin/test",
      { headers: { "Cf-Access-Jwt-Assertion": "invalid-token" } },
      env,
    )

    expect(response.status).toEqual(401)
    expect(await response.text()).toEqual("Unauthorized")
  })

  // verifier を注入するテストは middleware の分岐しか見ないので、本物の JWT 検証もここで通す。
  // getRemoteJwkSet が issuer 単位で JWKS を module scope に cache するため、test ごとに team domain を変える
  describe("verifyAccessToken", () => {
    const realFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = realFetch
    })

    const setUpAccess = async (teamDomain: string) => {
      const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true })
      const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" }
      globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        if (String(input) !== `${teamDomain}/cdn-cgi/access/certs`) {
          throw Error(`想定外の JWKS 取得先: ${String(input)}`)
        }

        return Response.json({ keys: [jwk] })
      }) as unknown as typeof fetch
      const signToken = (claims: { audience: string; issuer: string; algorithm?: string }) => {
        return new SignJWT({})
          .setProtectedHeader({ alg: claims.algorithm ?? "RS256", kid: "test-key" })
          .setIssuer(claims.issuer)
          .setAudience(claims.audience)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey)
      }

      return { signToken, privateKey }
    }

    test("正しい署名・issuer・audience の token を受け入れる", async () => {
      const teamDomain = "https://valid.cloudflareaccess.com"
      const { signToken } = await setUpAccess(teamDomain)
      const token = await signToken({ audience: "admin-audience", issuer: teamDomain })

      await expect(verifyAccessToken(token, teamDomain, "admin-audience")).resolves.toBeUndefined()
    })

    test("audience が違う token を拒否する", async () => {
      const teamDomain = "https://audience.cloudflareaccess.com"
      const { signToken } = await setUpAccess(teamDomain)
      const token = await signToken({ audience: "preview-audience", issuer: teamDomain })

      await expect(verifyAccessToken(token, teamDomain, "admin-audience")).rejects.toThrow()
    })

    test("issuer が違う token を拒否する", async () => {
      const teamDomain = "https://issuer.cloudflareaccess.com"
      const { signToken } = await setUpAccess(teamDomain)
      const token = await signToken({
        audience: "admin-audience",
        issuer: "https://attacker.example.com",
      })

      await expect(verifyAccessToken(token, teamDomain, "admin-audience")).rejects.toThrow()
    })

    test("別の鍵で署名された token を拒否する", async () => {
      const teamDomain = "https://signature.cloudflareaccess.com"
      await setUpAccess(teamDomain)
      const { privateKey } = await generateKeyPair("RS256", { extractable: true })
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(teamDomain)
        .setAudience("admin-audience")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey)

      await expect(verifyAccessToken(token, teamDomain, "admin-audience")).rejects.toThrow()
    })

    test("期限切れの token を拒否する", async () => {
      const teamDomain = "https://expired.cloudflareaccess.com"
      // 署名も issuer も audience も正しく、期限だけが切れている token を作る
      const { privateKey } = await setUpAccess(teamDomain)
      const expired = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(teamDomain)
        .setAudience("admin-audience")
        .setIssuedAt(Math.floor(Date.now() / 1_000) - 7_200)
        .setExpirationTime(Math.floor(Date.now() / 1_000) - 3_600)
        .sign(privateKey)

      await expect(verifyAccessToken(expired, teamDomain, "admin-audience")).rejects.toThrow()
    })
  })

  test("Access 設定がなければ fail closed にする", async () => {
    const verifier = vi.fn(async () => {})
    const response = await createApp(verifier).request(
      "/admin/test",
      { headers: { "Cf-Access-Jwt-Assertion": "signed-token" } },
      { ACCESS_PREVIEW_AUD: "preview-audience" },
    )

    expect(response.status).toEqual(500)
    expect(verifier).not.toHaveBeenCalled()
  })
})
