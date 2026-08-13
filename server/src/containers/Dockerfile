# 🔴 Notion の記事をビルドする実装ができるまでの仮コンテナ

FROM oven/bun:1.3.3

EXPOSE 8080

CMD ["bun", "--eval", "Bun.serve({ port: 8080, fetch: () => new Response('Not implemented', { status: 501 }) })"]
