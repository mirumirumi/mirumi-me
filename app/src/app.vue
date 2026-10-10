<template>
  <div id="app" ref="app">
    <ModulesTheHeader />
    <NuxtLoadingIndicator
      :height="2.9"
      :duration="1777"
      :color="'var(--color-mi)'"
      :throttle="199"
    />
    <NuxtPage id="container" />
    <ModulesTheFooter />
  </div>
</template>

<script setup lang="ts">
import { normalizePageViewPath } from "shared/page-views"

const router = useRouter()
const runtimeConfig = useRuntimeConfig()

const app = ref()

onMounted(async () => {
  console.log(`
ご訪問ありがとうございます :)

MMMMMMMMWX0xoc:,,'''''',,:cox0XWMMMMMMMM
MMMMMWNOo:,,,'''''''''''''''',:oONMMMMMM
MMMMXxc;cdkOOkxdoc;,'''''''''''',cxXWMMM
MMNOc,';OWMMMMMMWNKxoc,''''''''''',cONMM
MXd;''',cxkOO0KNWMMWWXd,'''''''''''';dXM
Xo,''''''''',,;cxXMMMMXo,'''''''''''',oX
x;'''''''''''''',oNMMMWk;''''''''''''';x
:'''''''''',,,,,'cKMMMMO;'''';odl,''''':
,'''',:ldxkOOOOOk0NMMMMO:''';xWMNd,'''',
''',ckXWMMMMMMMMMMMMMMMNKkdloXMMMO:'''''
'''cKWMWXOkxxkkOXWMMMMMMMMWWNWMMM0:'''''
,',xWMMXo,''''';kWMMMXkk0XWMMMMMMNkc,'',
l,;kWMMWx,''',cONMMX0d,',:oKWMMMMMMNk:,l
0:,oXMMMNkoodONMMWKo;,'''';OWMMWNWMMXoc0
WO:;dXWMMMWWMMMWXk:,''''',xNMMWOclddllOW
MW0l;cdOKXNNXKkd:,'''''''cKMMMKl''',l0WM
MMMXkc,,;::::,,''''''''''c0NN0l,',ckXMMM
MMMMWXkl;,''''''''''''''',:cc;,;lkXWMMMM
MMMMMMMN0xo:,,'''''''''''',,:lx0NMMMMMMM
MMMMMMMMMMWKkoc;,'''''',;cokKNMMMMMMMMMM

© みるめも
`)

  sendPageView(router.currentRoute.value.path)
})

watch(
  () => router.currentRoute.value,
  (newValue) => {
    sendPageView(newValue.path)
  },
)

// 1 PV ずつ Workers に送り、Analytics Engine に書いてもらう。応答は待たない。
// 一覧（/entries/）と検索（/s/）は WordPress 時代から数えていない。ローカルの nuxt dev では送らない。
// sendBeacon は使わない。ブラウザのトラッカーブロック（Vivaldi の標準など）が ping として止めるため。
// keepalive つきの fetch なら、ページを離れる途中でも送り切れる
function sendPageView(path: string): void {
  if (import.meta.dev) return
  const normalized = normalizePageViewPath(path)
  if (!normalized || normalized === "/entries/" || normalized === "/s/") return

  const url = `${runtimeConfig.public.workersApiOrigin}/api/pv`
  void fetch(url, { method: "POST", body: normalized, keepalive: true }).catch(() => undefined)
}
</script>

<style lang="scss">
#app {
  background-color: var(--color-background);

  #container {
    width: var(--width-max-screen);
    margin: 0 auto;
    padding: 0.9em 0.5em 2.3em;

    @include tablet {
      width: 100%;
    }

    @include mobile {
      width: 100%;
      padding: 1em 0.87em;
    }
  }
}
</style>
