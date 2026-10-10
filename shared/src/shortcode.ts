// `[name key="value" …]` の属性を読む。render と、公開前に外部から値を引く enrichment で使う
export const parseShortcodeAttributes = (value: string): Record<string, string> => {
  const attributes: Record<string, string> = {}
  for (const match of value.matchAll(/([a-zA-Z][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    if (match[1] && match[2] !== undefined) {
      attributes[match[1]] = match[2].replaceAll('\\"', '"')
    }
  }

  return attributes
}
