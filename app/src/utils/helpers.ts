export const today = () => {
  return new Date().toISOString()
}

export const round = (value: number, base = 6): number => {
  return Math.round(value * 10 ** base) / 10 ** base
}

export const delay = (msec: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, msec)
  })
}

export const toBool = (data: string): boolean => {
  return data.toLowerCase() === "true"
}

export const zeroPadding = (input: number, precision: number): string => {
  return (Array(precision).join("0") + input).slice(-precision)
}

// ビルドは CI（UTC）で走るため、実行環境のタイムゾーンに依存させると日付が前日にずれる
export const friendlyDatetime = (isoformat: string): string => {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(isoformat))
    .replaceAll("-", "/")
}

export function isIOS(): boolean {
  // https://bit.ly/2D2QKav
  return (
    ["iPad Simulator", "iPhone Simulator", "iPod Simulator", "iPad", "iPhone", "iPod"].includes(
      navigator.platform,
    ) ||
    (navigator.userAgent.includes("Mac") && "ontouchend" in document)
  )
}
