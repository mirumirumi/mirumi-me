<template>
  <div class="header_wrap">
    <header>
      <div class="site_logo">
        <NuxtLink :to="{ path: '/', force: true, replace: true }">
          <img src="@/assets/svgs/site-icon.svg" alt="site-icon">
        </NuxtLink>
      </div>
      <nav aria-label="global-menu">
        <ul class="menu">
          <li>
            <NuxtLink to="/all-entries">
              記事一覧
            </NuxtLink>
          </li>
          <li>
            <div class="category_menu" @mouseenter="(hoverCategory = true)" @mouseleave="(hoverCategory = false)">
              <span>かてごり</span>
              <PartsSvgIcon :icon="'angle_down'" :color="'var(--color-gray)'" :hover="{ on: hoverCategory, color: 'var(--color-mi)' }" />
            </div>
          </li>
          <li>
            <NuxtLink to="/what-is-this-blog">
              みるめも について
            </NuxtLink>
          </li>
          <li>
            <NuxtLink to="/profile">
              書いている人
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </header>
  </div>
</template>

<script setup lang="ts">
const hoverCategory = ref(false)
</script>

<style lang="scss" scoped>
.header_wrap {
  header {
    width: 100%;
    max-width: var(--width-max-screen);
    margin: auto;
    padding: 23px 29px 30px;
    .site_logo {
      display: block;
      width: 100%;
      text-align: center;
      a {
        display: inline-block;
        img {
          width: 48px;
          height: 48px;
          @include mobile {
            --mobile-logo-size: 43px;
            width: var(--mobile-logo-size);
            height: var(--mobile-logo-size);
          }
        }
      }
    }
    nav {
      display: block;
      height: 57px;
      margin-top: 1.1em;
      text-align: center;
      .menu {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 3em;
        height: 100%;
        li {
          position: relative;
          height: 100%;
          * {
            font-weight: bold;
            text-decoration: none;
          }
          a, .category_menu {
            display: flex;
            align-items: center;
            height: 100%;
            color: var(--color-gray);
            font-size: 0.8em;
            transition: 0.29s all ease;
            svg {
              position: relative;
              top: 0.1em;
              right: 0;
              width: 1.9em;
              transform: scale(0.4);
            }
            &:hover {
              color: var(--color-mi);
            }
          }
          .category_menu {
            margin-left: 1.3em;
            margin-right: -0.9em;
            cursor: pointer;
          }
          @include mobile {
            width: 40px;
          }
        }
        @include mobile {
          width: 220px;
        }
      }
      @include mobile {
        --padding-top: 17px;
        height: calc(var(--mobile-logo-size) + var(--padding-top));
        padding: var(--padding-top) 13px 0;
      }
    }
  }
}
</style>
