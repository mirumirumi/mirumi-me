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
import type { MediaObject, MediaObjectMetadata, MediaObjectStore } from "./images"

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
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      )
      if (!response.Body || !response.ETag) {
        throw Error("publish index の body または ETag がありません")
      }

      return {
        body: await response.Body.transformToString("utf8"),
        etag: response.ETag,
      }
    } catch (err) {
      if (isNotFound(err)) {
        return null
      }

      throw err
    }
  }

  async put(key: string, body: string, condition: DeploymentIndexWriteCondition): Promise<string> {
    const response = await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-cache",
        IfMatch: condition.ifMatch ?? undefined,
        IfNoneMatch: condition.ifNoneMatch ? "*" : undefined,
      }),
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

  async put(key: string, object: SiteObject): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: object.body,
        ContentType: object.contentType,
        CacheControl: object.cacheControl,
      }),
    )
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }))
  }
}

const toMediaMetadata = (
  metadata: Record<string, string> | undefined,
): MediaObjectMetadata | null => {
  if (
    !metadata?.["transform-version"] ||
    !metadata["variant-hash"] ||
    (metadata.usage !== "body" && metadata.usage !== "thumbnail") ||
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
      const response = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
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
    await this.#client.send(
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
    await this.#client.send(
      new CreateInvalidationCommand({
        DistributionId: this.#distributionId,
        InvalidationBatch: {
          CallerReference: callerReference,
          Paths: { Quantity: paths.length, Items: paths },
        },
      }),
    )
  }
}

export type { AwsClientConfig }
