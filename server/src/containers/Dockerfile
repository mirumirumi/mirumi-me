FROM oven/bun:1.3.3

# Nuxt generate が /app/app/.output へ書き込むため、WORKDIR ごと bun ユーザーに渡してから非 root で通す
RUN mkdir -p /app && chown bun:bun /app
WORKDIR /app
USER bun

COPY --chown=bun:bun package.json bun.lock tsconfig.json ./
COPY --chown=bun:bun app/package.json app/package.json
COPY --chown=bun:bun server/package.json server/package.json
COPY --chown=bun:bun shared/package.json shared/package.json
COPY --chown=bun:bun tools/migrate-to-notion/package.json tools/migrate-to-notion/package.json
COPY --chown=bun:bun tools/site-admin-extension/package.json tools/site-admin-extension/package.json
COPY --chown=bun:bun patches patches

RUN bun install --frozen-lockfile

COPY --chown=bun:bun app app
COPY --chown=bun:bun server server
COPY --chown=bun:bun shared shared

EXPOSE 8080

CMD ["bun", "run", "server/src/containers/http.ts"]
