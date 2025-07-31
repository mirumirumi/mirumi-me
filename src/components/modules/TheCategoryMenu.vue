<template>
  <Transition name="fadedown" appear>
    <div class="category_menu" v-if="_isShown">
      <ul>
        <li
          v-for="category in categories"
          :class="{ others_li_wrap: category.slug === 'others' }"
          :key="category.name"
        >
          <div
            v-if="category.slug === 'others'"
            class="others_wrap"
            @mouseenter="isShownOthers = true"
            @mouseleave="isShownOthers = false"
            @click.stop
          >
            <div class="others_title">
              <span :class="{ current: category.current }">
                {{ category.name }}
              </span>
              <PartsSvgIcon
                :icon="'angle_down'"
                :color="'var(--color-gray)'"
                :class="{ rotate: isShownOthers }"
              />
            </div>
            <Transition name="fade" appear>
              <ul v-if="isShownOthers">
                <li v-for="other in others" :key="other.name">
                  <NuxtLink
                    :to="`/category/${other.slug}/`"
                    :class="{ current: other.current }"
                    @click="interruptChoose"
                  >
                    {{ other.name }}
                  </NuxtLink>
                </li>
              </ul>
            </Transition>
          </div>
          <NuxtLink
            v-else
            :to="`/category/${category.slug}/`"
            :class="{ current: category.current }"
          >
            {{ category.name }}
          </NuxtLink>
        </li>
      </ul>
      <Teleport to="body">
        <PartsTransparentBack @click="interruptChoose" />
      </Teleport>
    </div>
  </Transition>
</template>

<script setup lang="ts">
interface Category {
  name: string
  slug: string
  current?: boolean
}

const p = defineProps<{
  isShown: boolean
}>()

const emit = defineEmits(["interruptChoose"])

const route = useRoute()
const appConfig = useAppConfig()

const _isShown = ref(p.isShown)
const isShownOthers = ref(false)

const categories: Array<Category> = [
  { name: "PC", slug: "pc" },
  { name: "スマートフォン", slug: "mobile" },
  { name: "ゲーム", slug: "game" },
  { name: "くらし", slug: "life" },
  { name: "テクノロジー", slug: "technology" },
  { name: "ブログ", slug: "blog" },
  { name: "雑記", slug: "notes" },
  { name: "その他", slug: "others" },
]
const others: Array<Category> = [
  { name: "Software Design", slug: "software-design" },
  { name: "Up&Coming", slug: "up-and-coming" },
  { name: "音楽", slug: "music" },
  { name: "枕", slug: "pillow" },
  { name: "カーナビ", slug: "car-navigation-system" },
  { name: "明晰夢/体外離脱", slug: "dreaming" },
]

await setIsCurrentCategory()

watch(
  () => p.isShown,
  () => {
    _isShown.value = p.isShown
  }
)

watch(
  () => route.path,
  async () => {
    await setIsCurrentCategory()
  }
)

async function setIsCurrentCategory() {
  let categorySlug = ""

  if (route.params.categoryName) {
    // In category page

    categorySlug = route.path.replace(/\/category\/(.*?)\//gim, "$1")
  } else if (route.params.post) {
    // In post page

    const pagePath = route.path.replaceAll("/", "")

    // https://github.com/nuxt/nuxt/discussions/??? (The page is gone... (cause by unifying repos for Nuxt 2~3))
    categorySlug = await $fetch<string>(
      `/mirumi/category_slug_with_post_slug/${pagePath}`,
      {
        baseURL: appConfig.baseURL,
        parseResponse: JSON.parse,
      }
    )
  }

  for (const category of categories) {
    category.current = categorySlug === category.slug
  }

  for (const other of others) {
    if (categorySlug === other.slug) {
      other.current = true
      categories.slice(-1)[0].current = true // `その他`
    } else {
      other.current = false
    }
  }
}

const interruptChoose = () => {
  _isShown.value = false
  isShownOthers.value = false
  emit("interruptChoose")
}
</script>

<style lang="scss" scoped>
.category_menu {
  position: absolute;
  top: 3.7em;
  left: -0.7em;
  width: 172px;
  padding: 7px 5px;
  color: var(--color-gray);
  border-radius: 13px;
  background-color: var(--color-background);
  box-shadow: 0px 2.9px 11px -4px rgb(0 0 0 / 23%);
  z-index: 14;
  ul {
    li {
      padding: 0 0.9em;
      line-height: 2;
      text-align: left;
      border-radius: 7px;
      .others_wrap {
        cursor: default;
        .others_title {
          position: relative;
          span {
            &.current {
              color: var(--color-text);
            }
          }
          svg {
            right: 0em;
            width: 0.7em;
            transition: 0.13s all ease-in-out;
            &.rotate {
              transform: rotate(-180deg);
            }
          }
        }
        ul {
          margin-top: 0.3em;
          li {
            a {
              color: var(--color-gray);
              font-size: 0.94em;
              line-height: 1.9;
              &:hover {
                color: var(--color-text);
              }
            }
          }
        }
      }
      a,
      span,
      .others_wrap > .others_title > span {
        display: block;
        color: var(--color-gray);
        text-decoration: none;
        &.current {
          color: var(--color-text) !important;
        }
      }
      .current {
        color: var(--color-text);
      }
      &:hover {
        background-color: #f8f5f2;
        a {
          color: var(--color-text);
        }
        &.others_li_wrap {
          background-color: var(--color-background);
        }
      }
    }
  }
  @include tablet {
    left: -50%;
  }
  @include mobile {
    left: -71%;
  }
}
.dark {
  .category_menu {
    ul {
      li {
        &:hover {
          background-color: #504f4f;
          &.others_li_wrap {
            background-color: var(--color-background);
          }
        }
      }
    }
  }
}
</style>
