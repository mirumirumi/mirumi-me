import { z } from "zod"

const verificationSchema = z.strictObject({
  verification_token: z.string().min(1),
})

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
// event を起こした user / bot。integration 自身（import や公開フォームの create）による event は
// authors が bot だけになる。type は person / bot 以外（agent など）が増えても event を捨てないよう string で受ける
const authorsSchema = z
  .array(z.object({ id: z.string().min(1), type: z.string().min(1) }))
  .optional()
const pagePropertiesUpdatedSchema = z.object({
  id: z.string().min(1).max(100),
  timestamp: timestampSchema,
  type: z.literal("page.properties_updated"),
  authors: authorsSchema,
  entity: z.object({
    id: z.string().min(1),
    type: z.literal("page"),
  }),
  data: z.object({
    updated_properties: z.array(z.string().min(1)),
  }),
})
// page.created には updated_properties が無い。comments の row かどうかは page を取得して判定する
const pageCreatedSchema = z.object({
  id: z.string().min(1).max(100),
  timestamp: timestampSchema,
  type: z.literal("page.created"),
  authors: authorsSchema,
  entity: z.object({
    id: z.string().min(1),
    type: z.literal("page"),
  }),
})

export interface NotionWebhookVerification {
  kind: "verification"
  verificationToken: string
}

export interface NotionWebhookEvent {
  kind: "event"
  event: z.infer<typeof pagePropertiesUpdatedSchema>
}

export interface NotionPageCreatedWebhookEvent {
  kind: "page-created"
  event: z.infer<typeof pageCreatedSchema>
}

export interface IgnoredNotionWebhookEvent {
  kind: "ignored"
  type: string
  // 既知の型なのに schema に合わなかったとき。署名が正しければ 200 で捨てて log に残す
  // （4xx を返し続けると Notion が配信を止めてしまう）
  reason: string | null
}

export type ParsedNotionWebhook =
  | NotionWebhookVerification
  | NotionWebhookEvent
  | NotionPageCreatedWebhookEvent
  | IgnoredNotionWebhookEvent

interface TimingSafeSubtleCrypto extends SubtleCrypto {
  timingSafeEqual?: (left: Uint8Array, right: Uint8Array) => boolean
}

const encoder = new TextEncoder()

const createHmacDigest = async (rawBody: string, secret: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)))
}

const hexFromBytes = (bytes: Uint8Array): string => {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const bytesFromHex = (value: string): Uint8Array => {
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  const subtle = crypto.subtle as TimingSafeSubtleCrypto
  if (subtle.timingSafeEqual) {
    return subtle.timingSafeEqual(left, right)
  }

  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }

  return difference === 0
}

export const createNotionWebhookSignature = async (
  rawBody: string,
  secret: string,
): Promise<string> => {
  const digest = hexFromBytes(await createHmacDigest(rawBody, secret))

  return `sha256=${digest}`
}

export const verifyNotionWebhookSignature = async (
  rawBody: string,
  provided: string,
  secret: string,
): Promise<boolean> => {
  if (!/^sha256=[0-9a-f]{64}$/i.test(provided)) {
    return false
  }

  const expectedBytes = await createHmacDigest(rawBody, secret)
  const providedBytes = bytesFromHex(provided.slice("sha256=".length))

  return timingSafeEqual(expectedBytes, providedBytes)
}

export const parseNotionWebhookBody = (rawBody: string): ParsedNotionWebhook => {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw Error("Webhook body が JSON ではありません")
  }

  const verification = verificationSchema.safeParse(parsed)
  if (verification.success) {
    return {
      kind: "verification",
      verificationToken: verification.data.verification_token,
    }
  }

  const envelope = z.object({ type: z.string() }).safeParse(parsed)
  if (!envelope.success) {
    throw Error("Webhook event の schema が不正です", { cause: envelope.error })
  }
  if (envelope.data.type === "page.created") {
    const created = pageCreatedSchema.safeParse(parsed)
    if (!created.success) {
      return { kind: "ignored", type: envelope.data.type, reason: created.error.message }
    }

    return { kind: "page-created", event: created.data }
  }
  if (envelope.data.type !== "page.properties_updated") {
    return { kind: "ignored", type: envelope.data.type, reason: null }
  }

  const event = pagePropertiesUpdatedSchema.safeParse(parsed)
  if (!event.success) {
    return { kind: "ignored", type: envelope.data.type, reason: event.error.message }
  }

  return { kind: "event", event: event.data }
}

// bot（integration）だけが起こした event か。person が 1 人でも混ざっていれば false
export const isBotOnlyEvent = (authors: z.infer<typeof authorsSchema>): boolean => {
  return authors !== undefined && 0 < authors.length && authors.every((a) => a.type === "bot")
}

export const normalizeNotionPropertyId = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
