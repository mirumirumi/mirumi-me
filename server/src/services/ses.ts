import { type AwsSigningCredentials, signAwsRequest } from "../lib/aws-signature"
import type { Fetcher } from "../lib/types"

export interface SesEmail {
  from: string
  to: string
  subject: string
  text: string
}

export type EmailSender = (email: SesEmail) => Promise<void>

interface SesClientOptions {
  fetcher: Fetcher
  region: string
  credentials: AwsSigningCredentials
}

const SEND_TIMEOUT_MS = 15_000

// SES v2 の SendEmail を SigV4 で直接叩く。sandbox のまま使うので from / to は verified identity に限る
export const createSesEmailSender = ({
  fetcher,
  region,
  credentials,
}: SesClientOptions): EmailSender => {
  return async (email) => {
    const url = new URL(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`)
    const body = JSON.stringify({
      FromEmailAddress: email.from,
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: { Text: { Data: email.text, Charset: "UTF-8" } },
        },
      },
    })
    const headers = await signAwsRequest(
      { method: "POST", url, headers: { "content-type": "application/json" }, body },
      { region, service: "ses", credentials },
    )
    const response = await fetcher(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    if (!response.ok) {
      // 本文には宛先やエラー詳細が入るので status だけを残す
      await response.body?.cancel()
      throw Error(`SES SendEmail が失敗しました: ${response.status}`)
    }
    await response.body?.cancel()
  }
}
