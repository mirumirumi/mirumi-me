<template>
  <div class="footer_wrap">
    <footer>
      <div class="search_wrap">
        <ModulesSearchBox />
      </div>
      <div class="link_group">
        <ul class="links">
          <div class="group_title">
            About
          </div>
          <li>
            <NuxtLink to="/about">運営者情報</NuxtLink>
          </li>
          <li>
            <NuxtLink to="/privacy">プライバシーポリシー</NuxtLink>
          </li>
          <li>
            <NuxtLink to="/contact">お問い合わせ</NuxtLink>
          </li>
        </ul>
        <ul class="links">
          <div class="group_title">
            Tech
          </div>
          <li>
            <a href="https://github.com/mirumirumi" target="_top">GitHub</a>
          </li>
          <li>
            <a href="https://mirumi.tech" target="_top">mirumi.tech (技術ブログ)</a>
          </li>
          <li>
            <a href="https://zenn.dev/mirumi" target="_top">Zenn</a>
          </li>
        </ul>
      </div>
      <div class="copyright">
        © 2016-{{ new Date().getFullYear() }} みるめも
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
</script>

<style lang="scss" scoped>
.footer_wrap {
  footer {
    --color: #a8a8a8;
    color: var(--color);
    padding: 3.7em 1em 13px;
    background-color: var(--color-footer);
    .search_wrap {
      max-width: 31em;
      margin: auto auto 2.3em;
      padding-left: 2.7em;
    }
    .link_group {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 7em;
      padding-left: 4.3em;  // `mirumi.tech` is too long
      .links {
        font-size: 0.87em;
        .group_title {
          margin-bottom: 0.37em;
          font-weight: bold;
          font-size: 1.05em;
          line-height: 1.8;
        }
        li {
          display: block;
          line-height: 1.7;
          a {
            color: var(--color);
            font-size: 0.95em;
            text-decoration: none;
          }
          @include mobile {
            display: block;
            margin: 0.1em 1.3em;
          }
        }
      }
    }
    .copyright {
      margin-top: 3em;
      font-size: 0.83em;
      text-align: center;
    }
  }
}
</style>
