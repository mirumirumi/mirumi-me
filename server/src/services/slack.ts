// Slack の Incoming Webhook。URL は Workers の secret（SLACK_WEBHOOK_URL）で、dev / prd で同じチャンネルに送る
export const createSlackNotifier = (
  webhookUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): ((text: string) => Promise<void>) => {
  return async (text) => {
    const response = await fetcher(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`Slack への通知に失敗しました: ${response.status}`)
    }
  }
}
