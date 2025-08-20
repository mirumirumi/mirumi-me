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
              <NuxtLink to="/what-is-this-blog//">みるめも とは</NuxtLink>
            </li>
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
          <div class="group_title">Social</div>
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
            <!-- これ以上増やすときは 2 行にする -->
          </div>
        </div>
      </nav>
      <div class="bottom">
        <div class="space"></div>
        <div class="copyright">© 2016-{{ new Date().getFullYear() }} みるめも</div>
        <ModulesThemeSwitch />
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
        .icons {
          display: flex;
          align-items: center;
          margin-top: 10px;
          a {
            display: inline-block;
            margin-right: 1.3em;
            > * {
              position: static;
              width: 1.3em;
            }
          }
          @include mobile {
            width: 12em;
            margin-top: 0;
            transform: translateY(3px);
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
      justify-content: center;
      gap: 2.3em;
      margin-top: 3.7em;
      padding-right: 2.3em;
      .space {
        width: 55px;
        @include mobile {
          display: none;
        }
      }
      .copyright {
        font-size: 0.83em;
        text-align: center;
        @include mobile {
          transform: translateY(2.5px);
        }
      }
      .theme_switch {
        @include mobile {
          transform: scale(1.23) translateY(0px);
        }
      }
    }
    @include mobile {
      padding-top: 2.3em;
    }
  }
}
</style>
