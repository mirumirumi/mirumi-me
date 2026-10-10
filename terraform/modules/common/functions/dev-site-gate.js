// dev サイトを常時配信しつつ、鍵を知っている人だけに見せる。
// 初回だけ /__unlock?k=<secret> を踏むと長期 Cookie が入り、以降は素通しになる
function handler(event) {
  var request = event.request
  var secret = "${unlock_secret}"

  if (request.uri === "/__unlock") {
    if (request.querystring.k && request.querystring.k.value === secret) {
      return {
        statusCode: 302,
        statusDescription: "Found",
        headers: {
          location: { value: "/" },
        },
        cookies: {
          "mirumi-dev": {
            value: secret,
            attributes: "Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax",
          },
        },
      }
    }
  }

  var cookie = request.cookies["mirumi-dev"]
  if (cookie && cookie.value === secret) {
    return request
  }

  return {
    statusCode: 403,
    statusDescription: "Forbidden",
  }
}
