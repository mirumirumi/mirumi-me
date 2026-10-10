import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

import type {
  DeploymentIndexStore,
  DeploymentIndexStoredObject,
  DeploymentIndexWriteCondition,
} from "../repositories/deployment-index"
import type { MediaObject, MediaObjectMetadata, MediaObjectStore, MediaUsage } from "./images"

interface AwsClientConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface SiteObject {
  body: Uint8Array
  contentType: string
  cacheControl: string
}

export interface SiteObjectStore {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, object: SiteObject): Promise<void>
  delete(key: string): Promise<void>
}

const isNotFound = (err: unknown): boolean => {
  if (!err || typeof err !== "object") {
    return false
  }
  const value = err as { name?: string; $metadata?: { httpStatusCode?: number } }

  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  )
}

// Bun 1.3 の node:https は、並列のリクエストでときどき応答が流れてこなくなり、AWS SDK の promise が
// 永久に settle しない（oven-sh/bun#26066。2026-10-10 に dev の非公開が Container の中で止まって踏んだ）。
// SDK には既定のタイムアウトがなく、requestTimeout も応答の header が届いた時点で外れて body の読み込みを守らない。
// そこで body を読み終えるまでの 1 回の操作をこちらで時間で打ち切り、べき等な操作はやり直す
const AWS_OPERATION_TIMEOUT_MS = 60_000
const AWS_OPERATION_ATTEMPTS = 3
// 大きな PUT（検索の索引や 1 GiB までの audio / video）に、1 MiB あたり 1 秒の余裕を足す
const UPLOAD_MS_PER_MIB = 1_000

interface AwsOperationOptions {
  timeoutMs: number
  attempts: number
}

const DEFAULT_AWS_OPERATION_OPTIONS: AwsOperationOptions = {
  timeoutMs: AWS_OPERATION_TIMEOUT_MS,
  attempts: AWS_OPERATION_ATTEMPTS,
}

class AwsOperationTimeoutError extends Error {}

const uploadOptions = (byteLength: number, attempts: number): AwsOperationOptions => {
  return {
    timeoutMs: AWS_OPERATION_TIMEOUT_MS + Math.ceil(byteLength / 1_048_576) * UPLOAD_MS_PER_MIB,
    attempts,
  }
}

export const runAwsOperation = async <T>(
  label: string,
  operation: (abortSignal: AbortSignal) => Promise<T>,
  options: AwsOperationOptions,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(
          new AwsOperationTimeoutError(
            `AWS の ${label} が ${options.timeoutMs / 1_000} 秒以内に終わりませんでした`,
          ),
        )
      }, options.timeoutMs)
    })
    try {
      // abort が届かずに止まったままの試行もあるので、終わりは abort ではなく競争で決める
      return await Promise.race([operation(controller.signal), timedOut])
    } catch (err) {
      if (!(err instanceof AwsOperationTimeoutError) || options.attempts <= attempt) {
        throw err
      }
      console.warn(JSON.stringify({ event: "aws_operation_timed_out", label, attempt }))
    } finally {
      clearTimeout(timer)
    }
  }
}

const createS3Client = (config: AwsClientConfig): S3Client => {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export class S3DeploymentIndexStore implements DeploymentIndexStore {
  readonly #client: S3Client
  readonly #bucket: string

  constructor(config: AwsClientConfig, bucket: string) {
    this.#client = createS3Client(config)
    this.#bucket = bucket
  }

  async get(key: string): Promise<DeploymentIndexStoredObject | null> {
    try {
      return await runAwsOperation(
        `S3 GET ${key}`,
        async (abortSignal) => {
          const response = await this.#client.send(
            new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
            { abortSignal },
          )
          if (!response.Body || !response.ETag) {
            throw Error("publish index の body または ETag がありません")
          }

          return {
            body: await response.Body.transformToString("utf8"),
            etag: response.ETag,
          }
        },
        DEFAULT_AWS_OPERATION_OPTIONS,
      )
    } catch (err) {
      if (isNotFound(err)) {
        return null
      }

      throw err
    }
  }

  async put(key: string, body: string, condition: DeploymentIndexWriteCondition): Promise<string> {
    // 条件つきの書き込みは、時間切れでも S3 には書けていることがある。同じ条件でやり直すと 412 になって
    // 原因が見えなくなるので、やり直さずに失敗させる（job ごとやり直せば index を読み直す）
    const response = await runAwsOperation(
      `S3 PUT ${key}`,
      (abortSignal) =>
        this.#client.send(
          new PutObjectCommand({
            Bucket: this.#bucket,
            Key: key,
            Body: body,
            ContentType: "application/json; charset=utf-8",
            CacheControl: "no-cache",
            IfMatch: condition.ifMatch ?? undefined,
            IfNoneMatch: condition.ifNoneMatch ? "*" : undefined,
          }),
          { abortSignal },
        ),
      uploadOptions(new TextEncoder().encode(body).byteLength, 1),
    )
    if (!response.ETag) {
      throw Error("publish index の PUT から ETag が返りませんでした")
    }

    return response.ETag
  }
}

export class S3SiteObjectStore implements SiteObjectStore {
  readonly #client: S3Client
  readonly #bucket: string

  constructor(config: AwsClientConfig, bucket: string) {
    this.#client = createS3Client(config)
    this.#bucket = bucket
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await runAwsOperation(
        `S3 GET ${key}`,
        async (abortSignal) => {
          const response = await this.#client.send(
            new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
            { abortSignal },
          )

          return response.Body ? await response.Body.transformToByteArray() : null
        },
        DEFAULT_AWS_OPERATION_OPTIONS,
      )
    } catch (err) {
      if (isNotFound(err)) {
        return null
      }

      throw err
    }
  }

  async put(key: string, object: SiteObject): Promise<void> {
    await runAwsOperation(
      `S3 PUT ${key}`,
      (abortSignal) =>
        this.#client.send(
          new PutObjectCommand({
            Bucket: this.#bucket,
            Key: key,
            Body: object.body,
            ContentType: object.contentType,
            CacheControl: object.cacheControl,
          }),
          { abortSignal },
        ),
      uploadOptions(object.body.byteLength, AWS_OPERATION_ATTEMPTS),
    )
  }

  async delete(key: string): Promise<void> {
    await runAwsOperation(
      `S3 DELETE ${key}`,
      (abortSignal) =>
        this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }), {
          abortSignal,
        }),
      DEFAULT_AWS_OPERATION_OPTIONS,
    )
  }
}

const MEDIA_USAGES: ReadonlyArray<string> = [
  "body",
  "thumbnail",
  "audio",
  "video",
] satisfies Array<MediaUsage>

const isMediaUsage = (value: string | undefined): value is MediaUsage => {
  return value !== undefined && MEDIA_USAGES.includes(value)
}

const toMediaMetadata = (
  metadata: Record<string, string> | undefined,
): MediaObjectMetadata | null => {
  if (
    !metadata?.["transform-version"] ||
    !metadata["variant-hash"] ||
    !isMediaUsage(metadata.usage) ||
    !metadata.width ||
    !metadata.height
  ) {
    return null
  }

  return {
    transformVersion: metadata["transform-version"],
    variantHash: metadata["variant-hash"],
    usage: metadata.usage,
    width: metadata.width,
    height: metadata.height,
  }
}

export class S3MediaObjectStore implements MediaObjectStore {
  readonly #client: S3Client
  readonly #bucket: string

  constructor(config: AwsClientConfig, bucket: string) {
    this.#client = createS3Client(config)
    this.#bucket = bucket
  }

  async head(key: string): Promise<MediaObjectMetadata | null> {
    try {
      const response = await runAwsOperation(
        `S3 HEAD ${key}`,
        (abortSignal) =>
          this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }), {
            abortSignal,
          }),
        DEFAULT_AWS_OPERATION_OPTIONS,
      )
      const metadata = toMediaMetadata(response.Metadata)
      if (!metadata) {
        throw Error(`media object の metadata が不足しています: ${key}`)
      }

      return metadata
    } catch (err) {
      if (isNotFound(err)) {
        return null
      }

      throw err
    }
  }

  async put(key: string, object: MediaObject): Promise<void> {
    await runAwsOperation(
      `S3 PUT ${key}`,
      (abortSignal) =>
        this.#client.send(
          new PutObjectCommand({
            Bucket: this.#bucket,
            Key: key,
            Body: object.body,
            ContentType: object.contentType,
            CacheControl: "public,max-age=31536000,immutable",
            Metadata: {
              "transform-version": object.metadata.transformVersion,
              "variant-hash": object.metadata.variantHash,
              usage: object.metadata.usage,
              width: object.metadata.width,
              height: object.metadata.height,
            },
          }),
          { abortSignal },
        ),
      uploadOptions(object.body.byteLength, AWS_OPERATION_ATTEMPTS),
    )
  }
}

export class CloudFrontInvalidator {
  readonly #client: CloudFrontClient
  readonly #distributionId: string

  constructor(config: AwsClientConfig, distributionId: string) {
    this.#client = new CloudFrontClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    this.#distributionId = distributionId
  }

  async invalidate(paths: Array<string>, callerReference: string): Promise<void> {
    if (paths.length === 0) {
      return
    }
    // 同じ CallerReference の invalidation は CloudFront が 1 つにまとめるので、やり直してよい
    await runAwsOperation(
      "CloudFront CreateInvalidation",
      (abortSignal) =>
        this.#client.send(
          new CreateInvalidationCommand({
            DistributionId: this.#distributionId,
            InvalidationBatch: {
              CallerReference: callerReference,
              Paths: { Quantity: paths.length, Items: paths },
            },
          }),
          { abortSignal },
        ),
      DEFAULT_AWS_OPERATION_OPTIONS,
    )
  }
}

export type { AwsClientConfig }
