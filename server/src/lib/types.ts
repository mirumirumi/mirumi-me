export interface HonoEnv {
  Bindings: CloudflareBindings
  // Variables: { ミドルウェアがあればセットする値をここに書く }
}

// Bun と Workers で `typeof fetch` の形が食い違い mock を渡せなくなるため、必要な部分だけを取り出す
export type Fetcher = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>
