<template>
  <div class="header_wrap">
    <header>
      <div class="site_logo">
        <NuxtLink :to="{ path: '/', force: true, replace: true }">
          <img src="@/assets/svgs/site-icon.svg" alt="site-icon" aria-label="みるめも">
        </NuxtLink>
      </div>
      <nav role="navigation" aria-label="グローバルメニュー">
        <ul class="menu">
          <li>
            <NuxtLink to="/entries">
              記事一覧
            </NuxtLink>
          </li>
          <li>
            <div class="category_menu_wrap" @mouseenter="(isHoveredCategory = true)" @mouseleave="(isHoveredCategory = false)" @click="onClick">
              <span aria-label="カテゴリーメニュー">
                かてごり
              </span>
              <PartsSvgIcon :icon="'angle_down'" :color="'var(--color-gray)'" :hoverOn="isHoveredCategory" :hoverColor="hoverStyle" :class="{ 'rotate': isShownCategoryMenu }" />
              <ModulesTheCategoryMenu :isShown="isShownCategoryMenu" @interruptChoose="interruptChooseCategory" />
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
const isHoveredCategory = ref(false)
const isShownCategoryMenu = ref(false)

const hoverStyle = ref("var(--color-mi)")

const onClick = () => {
  if (isShownCategoryMenu.value) {
    isShownCategoryMenu.value = false
  } else {
    isShownCategoryMenu.value = true
    hoverStyle.value = "var(--color-gray)"
  }
}

const interruptChooseCategory = () => {
  isShownCategoryMenu.value = false
  isHoveredCategory.value = false
  hoverStyle.value = "var(--color-mi)"
}
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
      margin-top: 0.7em;
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
          a, .category_menu_wrap {
            display: flex;
            align-items: center;
            height: 100%;
            color: var(--color-gray);
            font-size: 0.8em;
            transition: 0.29s all ease;
            &:hover {
              color: v-bind(hoverStyle);
            }
          }
          .category_menu_wrap {
            position: relative;
            margin-left: 1.3em;
            margin-right: -0.9em;
            cursor: pointer;
            svg {
              position: relative;
              top: 0.1em;
              right: 0;
              width: 1.9em;
              transform: scale(0.4);
              transition: 0.17s all ease-in-out;
              &.rotate {
                transform: scale(0.4) rotate(180deg);
              }
            }
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
