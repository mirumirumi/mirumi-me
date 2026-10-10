import type { DeploymentPageState, SiteDeploymentState } from "../lib/publishing"
import { DeploymentIndexRepository } from "../repositories/deployment-index"
import { S3DeploymentIndexStore } from "./aws"
import type { ContainerConfig } from "./config"

export const selectDeploymentPageStates = (
  state: SiteDeploymentState,
  pageIds: Array<string>,
): Array<DeploymentPageState> => {
  return pageIds.map((pageId) => {
    const page = state.pages[pageId]
    if (!page) {
      return { pageId, status: "missing" }
    }
    if (page.status === "unpublished") {
      return { pageId, status: "unpublished" }
    }

    return {
      pageId,
      status: "published",
      deployedAt: page.deployedAt,
      publishedAt: page.publishedAt,
    }
  })
}

export const loadDeploymentPageStates = async (
  pageIds: Array<string>,
  config: ContainerConfig,
): Promise<Array<DeploymentPageState>> => {
  const repository = new DeploymentIndexRepository(
    new S3DeploymentIndexStore(
      {
        region: config.awsRegion,
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      },
      config.siteBucketName,
    ),
  )
  const loaded = await repository.load(false, "1970-01-01T00:00:00.000Z")

  return selectDeploymentPageStates(loaded.state, pageIds)
}
