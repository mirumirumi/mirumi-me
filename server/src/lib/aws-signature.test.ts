import { describe, expect, test } from "vitest"

import { signAwsRequest } from "./aws-signature"

// 期待値は Python の hmac / hashlib で AWS の手順を独立に実装して求めたもの
describe("signAwsRequest", () => {
  const credentials = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  }
  const now = new Date("2026-09-21T01:02:03.456Z")
  const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

  test("S3 の GetObject を host / x-amz-date / x-amz-content-sha256 で署名する", async () => {
    const headers = await signAwsRequest(
      {
        method: "GET",
        url: new URL(
          "https://bucket.s3.ap-northeast-1.amazonaws.com/_internal/publish-index-v1.json",
        ),
        headers: {},
        body: null,
      },
      { region: "ap-northeast-1", service: "s3", credentials, now },
    )

    expect(headers).toEqual({
      "x-amz-date": "20260921T010203Z",
      "x-amz-content-sha256": emptyHash,
      authorization:
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260921/ap-northeast-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=2d68a4abfea88e03f3d068f2bd0aa497a2dfe329b591d3a27f8925676b61d0de",
    })
  })

  test("SES の JSON POST は content-type も署名に含める", async () => {
    const headers = await signAwsRequest(
      {
        method: "POST",
        url: new URL("https://email.ap-northeast-1.amazonaws.com/v2/email/outbound-emails"),
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
      },
      { region: "ap-northeast-1", service: "ses", credentials, now },
    )

    expect(headers["content-type"]).toEqual("application/json")
    expect(headers["x-amz-content-sha256"]).toEqual(
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    )
    expect(headers.authorization).toEqual(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260921/ap-northeast-1/ses/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=a907f49481abc326b94823c50b0acc4c854e418b8056793f04e3af024b8b768a",
    )
  })

  test("path と query を RFC 3986 で正規化して並べ替える", async () => {
    const headers = await signAwsRequest(
      {
        method: "GET",
        url: new URL("https://example.amazonaws.com/path%20x/y?b=2&a=1&a=%2A"),
        headers: {},
        body: null,
      },
      { region: "us-east-1", service: "service", credentials, now },
    )

    expect(headers.authorization).toEqual(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260921/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=0eaff3583bf20c8bf0fd90e196e80179d8f15a37ce983f80090048fd10aeee01",
    )
  })
})
