// @ts-expect-error: パッケージの ESM ビルドに型定義が紐づいていない
import { useToast as useToastWithoutTypes } from "vue-toastification/dist/index.mjs"

export const useToast = useToastWithoutTypes as typeof import("vue-toastification").useToast
