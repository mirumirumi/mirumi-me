import type { MiddlewareHandler } from "hono"
import { createRemoteJWKSet, jwtVerify } from "jose"

import type { HonoEnv } from "../lib/types"

type RemoteJwkSet = ReturnType<typeof createRemoteJWKSet>

export type AccessTokenVerifier = (
  token: string,
  teamDomain: string,
  audience: string,
) => Promise<void>

export type AccessAudienceBinding =
  | "ACCESS_PREVIEW_AUD"
  | "ACCESS_ADMIN_AUD"
  | "ACCESS_LOCAL_DEV_AUD"

const remoteJwkSets = new Map<string, RemoteJwkSet>()

const getRemoteJwkSet = (issuer: string): RemoteJwkSet => {
  const cached = remoteJwkSets.get(issuer)
  if (cached) {
    return cached
  }

  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  remoteJwkSets.set(issuer, jwks)

  return jwks
}

export const verifyAccessToken: AccessTokenVerifier = async (token, teamDomain, audience) => {
  const issuer = new URL(teamDomain).origin
  await jwtVerify(token, getRemoteJwkSet(issuer), {
    algorithms: ["RS256"],
    audience,
    issuer,
  })
}

export const createAccessMiddleware = (
  audienceBinding: AccessAudienceBinding,
  verifier?: AccessTokenVerifier,
): MiddlewareHandler<HonoEnv> => {
  const verify = verifier ?? verifyAccessToken

  return async (c, next) => {
    const audience = c.env[audienceBinding]
    const teamDomain = c.env.ACCESS_TEAM_DOMAIN
    if (!audience || !teamDomain) {
      console.error(JSON.stringify({ event: "access_config_missing", audienceBinding }))

      return c.text("Access configuration is missing", 500)
    }

    const token = c.req.header("Cf-Access-Jwt-Assertion")
    if (!token) {
      return c.text("Unauthorized", 401)
    }

    try {
      await verify(token, teamDomain, audience)
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "access_token_rejected",
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )

      return c.text("Unauthorized", 401)
    }

    return next()
  }
}
