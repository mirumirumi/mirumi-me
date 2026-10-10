// AWS Signature Version 4 の最小実装。Worker から S3 の GetObject と SES v2 の SendEmail を叩くためだけに
// 使う。AWS SDK は Container 側にしか置かず、Worker の bundle には入れない

export interface AwsSigningCredentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface AwsSigningOptions {
  region: string
  service: string
  credentials: AwsSigningCredentials
  now?: Date
}

export interface SignableRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: string | Uint8Array | null
}

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer | Uint8Array): string => {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Workers の型では Uint8Array<ArrayBufferLike> を BufferSource に渡せないため、ArrayBuffer に揃える
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const sha256Hex = async (value: string | Uint8Array): Promise<string> => {
  const data = typeof value === "string" ? encoder.encode(value) : value

  return toHex(await crypto.subtle.digest("SHA-256", toArrayBuffer(data)))
}

const hmac = async (key: ArrayBuffer, value: string): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  return crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(encoder.encode(value)))
}

// RFC 3986 の unreserved 以外をすべて encode する（encodeURIComponent が残す `!'()*` も対象）
const rfc3986Encode = (value: string): string => {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

const canonicalPath = (url: URL): string => {
  const path = url.pathname || "/"

  return path
    .split("/")
    .map((segment) => rfc3986Encode(decodeURIComponent(segment)))
    .join("/")
}

const canonicalQuery = (url: URL): string => {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      return leftKey < rightKey ? -1 : rightKey < leftKey ? 1 : leftValue < rightValue ? -1 : 1
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&")
}

const amzDate = (now: Date): { dateTime: string; date: string } => {
  const dateTime = now
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")

  return { dateTime, date: dateTime.slice(0, 8) }
}

export const signAwsRequest = async (
  request: SignableRequest,
  options: AwsSigningOptions,
): Promise<Record<string, string>> => {
  const { dateTime, date } = amzDate(options.now ?? new Date())
  const payloadHash = await sha256Hex(request.body ?? "")
  const headers: Record<string, string> = {
    ...request.headers,
    host: request.url.host,
    "x-amz-date": dateTime,
    "x-amz-content-sha256": payloadHash,
  }
  const sortedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
  const canonicalHeaders = sortedHeaderNames
    .map((name) => {
      const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? ""

      return `${name}:${value.trim().replaceAll(/\s+/g, " ")}\n`
    })
    .join("")
  const signedHeaders = sortedHeaderNames.join(";")
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(request.url),
    canonicalQuery(request.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")
  const scope = `${date}/${options.region}/${options.service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateTime,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n")

  let key = toArrayBuffer(encoder.encode(`AWS4${options.credentials.secretAccessKey}`))
  for (const part of [date, options.region, options.service, "aws4_request"]) {
    key = await hmac(key, part)
  }
  const signature = toHex(await hmac(key, stringToSign))
  const authorization = `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  // host は fetch が URL から付けるため返さない（明示すると forbidden header として無視される）
  return {
    ...request.headers,
    "x-amz-date": dateTime,
    "x-amz-content-sha256": payloadHash,
    authorization,
  }
}
