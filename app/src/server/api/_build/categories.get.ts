import { getBuildContentReader } from "../../utils/build-content"

export default defineEventHandler(async () => {
  return getBuildContentReader().readCategories()
})
