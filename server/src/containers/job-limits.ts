// ジョブが固まったとみなすまでの時間。Container 本人の判定（`/jobs`）と、Container が応答しないときの
// DO 側の判定で同じ値を使う。Cloudflare 側には Container の最大実行時間の制限がないため、
// ここで止めないと固まった Container が寝ずに課金され続ける

// generate / bootstrap。ジョブがハングして promise が永久に settle しないと、409 で publish が止まり、
// Container は停止も作り直しもできなくなる。そこで「これ以上走っているならもう待っている人はいない」と
// 見なす線を引く。Workflow の polling 予算（12 時間）より長く取り、かつ実測より十分に離す
// （publish index が空の初回ビルドは 1 回で 4.7 時間走った記録がある＝本番 bootstrap も同水準）
export const BACKGROUND_JOB_STALE_MS = 14 * 60 * 60 * 1_000
// 公開とコメント反映。普段は 1.5〜4 分で終わり、Workflow の publishSite / refreshComments の step も
// 1 回の試行を 30 分で打ち切る
export const SYNC_JOB_STALE_MS = 30 * 60 * 1_000

// Container へのリクエストに答えが返らないと、ライブラリは inflight があるあいだ使用中とみなし、
// sleepAfter も onActivityExpired も動かなくなる。短いリクエストは Workflow の step が諦めるのと同じ長さで打ち切る
export const CONTROL_REQUEST_TIMEOUT_MS = 2 * 60 * 1_000
export const BACKGROUND_JOB_START_TIMEOUT_MS = 5 * 60 * 1_000

export type ContainerActivity = "busy" | "idle" | "unknown"

// stop は SIGTERM、destroy は SIGKILL。応答しなくなったプロセスは SIGTERM を受けられないので、
// 期限を過ぎたら destroy で止める。adopt は、渡した記録のないジョブが走っているので止めずに時計を始める
export type ExpiredAction = "stop" | "keep" | "destroy" | "adopt"

// DO が Container に渡して、まだ終わりを見届けていないジョブの開始時刻
export interface DispatchedJobTimes {
  background: number | null
  sync: number | null
}

export const decideExpiredAction = (
  activity: ContainerActivity,
  dispatched: DispatchedJobTimes,
  now: number,
): ExpiredAction => {
  if (activity === "idle") {
    return "stop"
  }
  const deadlines = [
    dispatched.background === null ? null : dispatched.background + BACKGROUND_JOB_STALE_MS,
    dispatched.sync === null ? null : dispatched.sync + SYNC_JOB_STALE_MS,
  ].filter((deadline) => deadline !== null)
  // この仕組みを入れる前の version が渡したジョブかもしれないので、いきなりは止めない
  if (deadlines.length === 0) {
    return "adopt"
  }

  return now < Math.max(...deadlines) ? "keep" : "destroy"
}
