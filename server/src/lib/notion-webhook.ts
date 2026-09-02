import { z } from "zod"

const verificationSchema = z.strictObject({
  verification_token: z.string().min(1),
})

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const pagePropertiesUpdatedSchema = z.object({
  id: z.string().min(1).max(100),
  timestamp: timestampSchema,
  type: z.literal("page.properties_updated"),
  entity: z.object({
    id: z.string().min(1),
    type: z.literal("page"),
  }),
  data: z.object({
    updated_properties: z.array(z.string().min(1)),
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

export interface IgnoredNotionWebhookEvent {
  kind: "ignored"
  type: string
}

export type ParsedNotionWebhook =
  | NotionWebhookVerification
  | NotionWebhookEvent
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
  if (envelope.data.type !== "page.properties_updated") {
    return { kind: "ignored", type: envelope.data.type }
  }

  const event = pagePropertiesUpdatedSchema.safeParse(parsed)
  if (!event.success) {
    throw Error("Webhook event の schema が不正です", { cause: event.error })
  }

  return { kind: "event", event: event.data }
}

export const normalizeNotionPropertyId = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
