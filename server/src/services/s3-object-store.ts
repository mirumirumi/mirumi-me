import { type AwsSigningCredentials, signAwsRequest } from "../lib/aws-signature"
import type { Fetcher } from "../lib/types"

export type S3StorageClass = "STANDARD" | "DEEP_ARCHIVE"

export interface S3PutOptions {
  contentType: string
  // hex。S3 側でも body と照合させる
  sha256: string
  storageClass: S3StorageClass
}

interface SignedS3ObjectStoreOptions {
  fetcher: Fetcher
  region: string
  bucket: string
  credentials: AwsSigningCredentials
}

const hexToBase64 = (hex: string): string => {
  const bytes = hex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []

  return btoa(String.fromCharCode(...bytes))
}

// Worker から S3 object を読み書きする最小 client。AWS SDK は Container 側にしか置かない
export class SignedS3ObjectStore {
  readonly #options: SignedS3ObjectStoreOptions

  constructor(options: SignedS3ObjectStoreOptions) {
    this.#options = options
  }

  async get(key: string): Promise<Uint8Array | null> {
    const { fetcher, region, credentials } = this.#options
    const url = this.#url(key)
    const headers = await signAwsRequest(
      { method: "GET", url, headers: {}, body: null },
      { region, service: "s3", credentials },
    )
    const response = await fetcher(url, { method: "GET", headers })
    if (response.status === 404) {
      await response.body?.cancel()

      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`S3 object の取得に失敗しました: ${response.status} ${key}`)
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  async put(key: string, body: Uint8Array, options: S3PutOptions): Promise<void> {
    const { fetcher, region, credentials } = this.#options
    const url = this.#url(key)
    const headers = await signAwsRequest(
      {
        method: "PUT",
        url,
        headers: {
          "content-type": options.contentType,
          "x-amz-storage-class": options.storageClass,
          "x-amz-checksum-sha256": hexToBase64(options.sha256),
        },
        body,
      },
      { region, service: "s3", credentials },
    )
    // Workers の型では Uint8Array<ArrayBufferLike> を BodyInit に渡せないため、ArrayBuffer に揃える
    const response = await fetcher(url, {
      method: "PUT",
      headers,
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`S3 object の書き込みに失敗しました: ${response.status} ${key}`)
    }
    await response.body?.cancel()
  }

  #url(key: string): URL {
    const { bucket, region } = this.#options

    return new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`)
  }
}
