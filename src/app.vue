<template>
  <div id="app" ref="app">
    <ModulesTheHeader />
    <NuxtPage id="container" />
    <ModulesTheFooter />
  </div>
</template>

<script setup lang="ts">
const router = useRouter()
const appConfig = useAppConfig()

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

  const slug = shapeSlug(router.currentRoute.value.path)
  await incrementAccessCounter(slug)
})

watch(() => router.currentRoute.value, async (newValue) => {
  const slug = shapeSlug(newValue.path)
  await incrementAccessCounter(slug)
})

async function incrementAccessCounter(slug: string): Promise<void> {
  if (/.*?\/.*?/gim.test(slug)) return
  if (slug === "entries") return
  if (slug === "s") return

  let postId = "0"

  if (slug.length === 0) {
    // In case of the top page
    postId = "12717"
  } else {
    postId = await $fetch(`/mirumi/post_id_with_post_slug/${slug}`, {
      baseURL: appConfig.baseURL,
      parseResponse: JSON.parse,
    })
  }
  if (!postId) return

  // Set only to satisfy PHP function of Cocoon, it doesn't matter if it's A or B
  const postType = "post"

  const div = document.createElement("div")
  div.style.cssText = `
    content: url("${appConfig.siteFullPath}/wp-content/themes/cocoon-master/lib/analytics/access.php?post_id=${postId}&post_type=${postType}");
    display: inline !important;
    position: absolute !important;
    bottom: 0 !important;
    right: 0 !important;
    width: 1px !important;
    height: 1px !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    box-shadow: none !important;
    visibility: hidden !important;
    overflow: hidden !important;
  `
  app.value.appendChild(div)
}

function shapeSlug(path: string): string {
  return path.slice(1).replace(/(.*?)\/$/gim, "$1")
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
