import { z } from "zod"

import type { Fetcher } from "../lib/types"

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const SITEVERIFY_TIMEOUT_MS = 10_000

const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
  hostname: z.string().optional(),
  action: z.string().optional(),
})

export interface TurnstileVerification {
  success: boolean
  errorCodes: Array<string>
  hostname: string | null
  action: string | null
}

interface VerifyTurnstileTokenOptions {
  fetcher: Fetcher
  secret: string
  token: string
  remoteIp: string | null
  // token は single-use なので、同じ token の再試行で二重検証にならないよう idempotency key を付ける
  idempotencyKey: string
}

const toUuid = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// request-id だけを key にすると、失敗後に widget を reset した別 token の再送まで同じ key で検証してしまう。
// token も混ぜて「同じ token の再送だけが同じ key」になるようにする。siteverify の要求どおり UUID 形式にする
export const createTurnstileIdempotencyKey = async (
  requestId: string,
  token: string,
): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${requestId}\0${token}`)),
  )
  digest[6] = (digest[6]! & 0x0f) | 0x40
  digest[8] = (digest[8]! & 0x3f) | 0x80

  return toUuid(digest)
}

export const verifyTurnstileToken = async ({
  fetcher,
  secret,
  token,
  remoteIp,
  idempotencyKey,
}: VerifyTurnstileTokenOptions): Promise<TurnstileVerification> => {
  const response = await fetcher(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
      idempotency_key: idempotencyKey,
    }),
    signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw Error(`Turnstile siteverify が失敗しました: ${response.status}`)
  }
  const parsed = siteverifyResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw Error("Turnstile siteverify の response が不正です")
  }

  return {
    success: parsed.data.success,
    errorCodes: parsed.data["error-codes"] ?? [],
    hostname: parsed.data.hostname ?? null,
    action: parsed.data.action ?? null,
  }
}

interface TurnstileExpectation {
  hostnames: ReadonlySet<string>
  action: string
}

// success だけでは別サイト・別用途の token を通してしまうため、hostname と action も照合する
export const isTurnstileVerificationAccepted = (
  verification: TurnstileVerification,
  expectation: TurnstileExpectation,
): boolean => {
  return (
    verification.success &&
    verification.hostname !== null &&
    expectation.hostnames.has(verification.hostname) &&
    verification.action === expectation.action
  )
}
