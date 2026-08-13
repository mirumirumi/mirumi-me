import { Context } from "hono"

import { HonoEnv } from "../lib/types"

export const getPreview = async (c: Context<HonoEnv>): Promise<Response> => {
  return c.json({ message: "ok" }, 200)
}
