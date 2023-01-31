<template>
  <div id="app">
    <ModulesTheHeader />
    <NuxtPage id="container" />
    <ModulesTheFooter />
  </div>
</template>

<script setup lang="ts">
onMounted(() => {
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
      padding: 1.7em 0.87em 1em;
    }
  }
}
</style>
