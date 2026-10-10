export const readLimitedText = async (
  request: Request,
  maxBytes: number,
): Promise<string | null> => {
  const contentLength = Number(request.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && maxBytes < contentLength) {
    return null
  }
  if (!request.body) {
    return ""
  }

  const reader = request.body.getReader()
  const chunks: Array<Uint8Array> = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    byteLength += value.byteLength
    if (maxBytes < byteLength) {
      await reader.cancel()

      return null
    }
    chunks.push(value)
  }

  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(body)
}
