import { z } from "zod"

const containerConfigSchema = z.strictObject({
  APP_ENV: z.enum(["dev", "prd"]),
  NOTION_TOKEN: z.string().min(1),
  NOTION_POSTS_DATA_SOURCE_ID: z.guid(),
  NOTION_PAGES_DATA_SOURCE_ID: z.guid(),
  NOTION_COMMENTS_DATA_SOURCE_ID: z.guid(),
  AMAZON_CARD_SIGNING_SECRET: z.string().min(16),
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  SITE_BUCKET_NAME: z.string().min(1),
  MEDIA_BUCKET_NAME: z.string().min(1),
  CLOUDFRONT_DISTRIBUTION_ID: z.string().min(1),
  THUMBNAIL_FUNCTION_URL: z.url(),
  WORKERS_API_ORIGIN: z.url(),
})

export interface ContainerConfig {
  appEnv: "dev" | "prd"
  notionToken: string
  notionPostsDataSourceId: string
  notionPagesDataSourceId: string
  notionCommentsDataSourceId: string
  amazonCardSigningSecret: string
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  siteBucketName: string
  mediaBucketName: string
  cloudFrontDistributionId: string
  thumbnailFunctionUrl: string
  workersApiOrigin: string
}

export const readContainerConfig = (
  environment: Record<string, string | undefined> = process.env,
): ContainerConfig => {
  const parsed = containerConfigSchema.parse({
    APP_ENV: environment.APP_ENV,
    NOTION_TOKEN: environment.NOTION_TOKEN,
    NOTION_POSTS_DATA_SOURCE_ID: environment.NOTION_POSTS_DATA_SOURCE_ID,
    NOTION_PAGES_DATA_SOURCE_ID: environment.NOTION_PAGES_DATA_SOURCE_ID,
    NOTION_COMMENTS_DATA_SOURCE_ID: environment.NOTION_COMMENTS_DATA_SOURCE_ID,
    AMAZON_CARD_SIGNING_SECRET: environment.AMAZON_CARD_SIGNING_SECRET,
    AWS_REGION: environment.AWS_REGION,
    AWS_ACCESS_KEY_ID: environment.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: environment.AWS_SECRET_ACCESS_KEY,
    SITE_BUCKET_NAME: environment.SITE_BUCKET_NAME,
    MEDIA_BUCKET_NAME: environment.MEDIA_BUCKET_NAME,
    CLOUDFRONT_DISTRIBUTION_ID: environment.CLOUDFRONT_DISTRIBUTION_ID,
    THUMBNAIL_FUNCTION_URL: environment.THUMBNAIL_FUNCTION_URL,
    WORKERS_API_ORIGIN: environment.WORKERS_API_ORIGIN,
  })

  return {
    appEnv: parsed.APP_ENV,
    notionToken: parsed.NOTION_TOKEN,
    notionPostsDataSourceId: parsed.NOTION_POSTS_DATA_SOURCE_ID,
    notionPagesDataSourceId: parsed.NOTION_PAGES_DATA_SOURCE_ID,
    notionCommentsDataSourceId: parsed.NOTION_COMMENTS_DATA_SOURCE_ID,
    amazonCardSigningSecret: parsed.AMAZON_CARD_SIGNING_SECRET,
    awsRegion: parsed.AWS_REGION,
    awsAccessKeyId: parsed.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    siteBucketName: parsed.SITE_BUCKET_NAME,
    mediaBucketName: parsed.MEDIA_BUCKET_NAME,
    cloudFrontDistributionId: parsed.CLOUDFRONT_DISTRIBUTION_ID,
    thumbnailFunctionUrl: parsed.THUMBNAIL_FUNCTION_URL,
    workersApiOrigin: parsed.WORKERS_API_ORIGIN,
  }
}
