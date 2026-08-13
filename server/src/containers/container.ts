import { Container } from "@cloudflare/containers"

export class BuildContainer extends Container<CloudflareBindings> {
  override defaultPort = 8080
  override sleepAfter = "15m"
}
