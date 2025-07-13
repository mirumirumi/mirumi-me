<template>
  <div class="footer_wrap">
    <footer itemscope itemtype="https://schema.org/WPFooter">
      <div class="search_wrap">
        <ModulesSearchBox :query="query" @onEnter="onEnter" />
      </div>
      <nav class="link_groups" role="navigation" aria-label="フッターメニュー">
        <div class="links">
          <div class="group_title">Page</div>
          <ul>
            <li>
              <NuxtLink to="/entry-list/">全記事一覧</NuxtLink>
            </li>
            <li>
              <NuxtLink to="/nice-to-meet-you-10/">はじめましての 10 記事</NuxtLink>
            </li>
          </ul>
        </div>
        <div class="links">
          <div class="group_title">About</div>
          <ul>
            <li>
              <NuxtLink to="/about/">運営者情報</NuxtLink>
            </li>
            <li>
              <NuxtLink to="/privacy-policy/">プライバシーポリシー</NuxtLink>
            </li>
            <li>
              <NuxtLink to="/contact/">お問い合わせ</NuxtLink>
            </li>
          </ul>
        </div>
        <div class="links">
          <div class="group_title">Tech</div>
          <ul>
            <li>
              <a href="https://github.com/mirumirumi" target="_blank">GitHub</a>
            </li>
            <li>
              <a href="https://mirumi.tech" target="_blank">mirumi.tech (技術ブログ)</a>
            </li>
            <li>
              <a href="https://zenn.dev/mirumi" target="_blank">Zenn</a>
            </li>
          </ul>
        </div>
      </nav>
      <div class="bottom">
        <div class="copyright">© 2016-{{ new Date().getFullYear() }} みるめも</div>
        <div class="right">
          <ModulesThemeSwitch />
          <div class="icons">
            <a href="https://x.com/__mirumi__" target="_blank" rel="nofollow"
              ><PartsSvgIcon :icon="'x'" :color="'#a8a8a8'"
            /></a>
            <a href="https://github.com/mirumirumi" target="_blank" rel="nofollow"
              ><PartsSvgIcon :icon="'github'" :color="'#a8a8a8'"
            /></a>
            <a href="https://zenn.dev/mirumi" target="_blank" rel="nofollow"
              ><PartsSvgIcon :icon="'zenn'" :color="'#a8a8a8'"
            /></a>
            <a href="https://note.com/mirumi_milmemo" target="_blank" rel="nofollow"
              ><PartsSvgIcon :icon="'note'" :color="'#a8a8a8'"
            /></a>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
const router = useRouter()

const query = ref("")

watch(
  () => router.currentRoute.value.fullPath,
  () => {
    query.value = router.currentRoute.value.query.q as string
  }
)

const onEnter = () => {
  window.scrollTo({
    top: 0,
    left: 0,
  })
}
</script>

<style lang="scss" scoped>
.footer_wrap {
  footer {
    --color: #a8a8a8;
    color: var(--color);
    padding: 2.9em 1em 23px;
    background-color: var(--color-footer);
    .search_wrap {
      max-width: 31em;
      margin: auto auto 2.7em;
      padding-left: 0.9em;
    }
    .link_groups {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      gap: 7em;
      padding-left: 4.3em; // `mirumi.tech` is too long
      .links {
        font-size: 0.87em;
        .group_title {
          margin-bottom: 0.37em;
          font-weight: bold;
          font-size: 1.05em;
          line-height: 1.8;
          @include mobile {
            width: 5em;
          }
        }
        ul {
          li {
            display: block;
            line-height: 1.7;
            a {
              color: var(--color);
              font-size: 0.95em;
              text-decoration: none;
            }
          }
          @include mobile {
            width: 12em;
          }
        }
        @include mobile {
          display: flex;
          align-items: baseline;
          margin: auto;
        }
      }
      @include mobile {
        flex-direction: column;
        gap: 1em;
        padding-left: 0;
      }
    }
    .bottom {
      display: flex;
      justify-content: space-evenly;
      margin-top: 3.7em;
      .copyright {
        font-size: 0.83em;
        text-align: center;
      }
      .right {
        display: flex;
        gap: 2.3em;
        transform: translateX(1em);
        .icons {
          display: flex;
          align-items: center;
          a {
            display: inline-block;
            margin-right: 1.3em;
            > * {
              position: static;
              width: 1.3em;
            }
          }
        }
      }
    }
    @include mobile {
      padding-top: 2.3em;
    }
  }
}
</style>
