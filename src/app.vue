<template>
  <div id="app" ref="app">
    <ModulesTheHeader />
    <NuxtPage id="container" />
    <ModulesTheFooter />
  </div>
</template>

<script setup lang="ts">
const appConfig = useAppConfig()

onMounted(() => {
  // Add an access counter
  const postId = "12717"
  const postType = "page"

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
  const app = templateRef("app")
  app.value?.appendChild(div)

  // 😽
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
})
</script>

<style lang="scss">
#app {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
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
